import type {
  RuntimeAppManifest,
  SettingsCategory,
  SettingsPanelActionResponse,
  SettingsPanelDefinition,
  SettingsPanelError,
  SettingsPanelProvider,
  SettingsPanelProviderContext,
  SettingsPanelRegistration,
  SettingsPanelRegistrationOptions,
  SettingsPanelResponse,
  SettingsPanelSummary,
  SettingsPanelValue,
  UserGrantOption,
  UserProfile,
} from "@edenapp/types";
import { delay, inject, singleton } from "tsyringe";
import { AppCatalog } from "../app-registry";
import { ExecutionContext } from "../execution";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import type { PackageManager } from "../package-manager";
import { SessionContext, type SessionManager } from "../session";
import {
  createGeneratedSettingsPanel,
  type GeneratedPanelOwner,
} from "./GeneratedSettingsPanel";
import { SettingsManager } from "./SettingsManager";
import {
  applyActionAuthorization,
  authorizePanelDeclaration,
  canOpenPanel,
  collectPanelGrantOptions,
  hasUserGrant,
} from "./SettingsPanelAuthorization";
import {
  cloneAndValidatePanelDefinition,
  cloneRendererValue,
  type InternalPanelDefinition,
  validatePanelActionInput,
  validatePanelProvider,
} from "./SettingsPanelCodec";
import { SettingsPanelHandler } from "./SettingsPanelHandler";
import type {
  PanelRenderer,
  PanelSource,
  SettingsPanelRecord,
} from "./SettingsPanelRecord";

interface SettingsPanelNamespaceEvents {
  "panels-changed": {
    reason: "catalog" | "grants" | "session" | "visibility";
  };
}

@singleton()
@EdenNamespace("settings")
export class SettingsPanelManager extends EdenEmitter<SettingsPanelNamespaceEvents> {
  private readonly panels = new Map<string, SettingsPanelRecord>();
  private lifecycleConnected = false;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(delay(() => SettingsManager))
    private readonly settingsManager: SettingsManager,
    @inject(AppCatalog) private readonly appCatalog: AppCatalog,
    @inject(SessionContext) private readonly sessionContext: SessionContext,
    @inject(ExecutionContext)
    private readonly executionContext: ExecutionContext,
  ) {
    super(ipcBridge);
    commandRegistry.registerManager(new SettingsPanelHandler(this));
  }

  /**
   * Register a trusted host panel. Declarations are copied and callbacks remain
   * private to this manager.
   */
  registerPanel(
    definition: SettingsPanelDefinition,
    provider: SettingsPanelProvider,
    options: SettingsPanelRegistrationOptions = {},
  ): SettingsPanelRegistration {
    if (options.visible !== undefined && typeof options.visible !== "boolean") {
      throw new Error("Settings panel visibility must be a boolean");
    }
    if (definition.id.startsWith("eden.") || definition.id.startsWith("app.")) {
      throw new Error(
        `Panel ID "${definition.id}" uses an Eden-reserved prefix`,
      );
    }
    if (!definition.grant?.trim()) {
      throw new Error("Host settings panels require a panel grant");
    }
    return this.register(
      definition,
      provider,
      "host",
      "generic",
      undefined,
      undefined,
      options.visible,
    );
  }

  /** Register an Eden-owned panel, including private custom renderers. */
  registerBuiltinPanel(
    definition: InternalPanelDefinition,
    provider: SettingsPanelProvider,
    renderer: PanelRenderer = "generic",
  ): SettingsPanelRegistration {
    if (!definition.id.startsWith("eden.")) {
      throw new Error("Built-in panel IDs must begin with eden.");
    }
    if (renderer !== "generic" && !definition.grant?.trim()) {
      throw new Error("Custom settings panels require a panel grant");
    }
    return this.register(definition, provider, "eden", renderer);
  }

  connectLifecycle(
    sessionManager: SessionManager,
    packageManager: PackageManager,
  ): void {
    if (this.lifecycleConnected) return;
    this.lifecycleConnected = true;

    sessionManager.on("changed", ({ currentUser, previousUsername }) => {
      this.notify(
        "panels-changed",
        currentUser?.username === previousUsername
          ? { reason: "grants" }
          : { reason: "session" },
      );
    });
    packageManager.on("installed", ({ manifest }) => {
      this.synchronizeManifestPanel(manifest);
      if (!manifest.settings?.length) {
        this.notify("panels-changed", { reason: "catalog" });
      }
    });
    packageManager.on("uninstalled", ({ appId }) => {
      this.removeManifestPanel(appId);
      this.notify("panels-changed", { reason: "catalog" });
    });
  }

  synchronizeManifestPanels(): void {
    const liveIds = new Set<string>();
    for (const manifest of this.appCatalog.all()) {
      if (!manifest.settings?.length) continue;
      liveIds.add(manifest.id);
      this.synchronizeManifestPanel(manifest);
    }

    for (const record of this.panels.values()) {
      if (
        record.source === "application" &&
        record.ownerAppId &&
        !liveIds.has(record.ownerAppId)
      ) {
        this.panels.delete(record.definition.id);
      }
    }
  }

  registerGeneratedBuiltinCategory(category: SettingsCategory): void {
    if (category.view) {
      throw new Error(
        `Custom settings category "${category.id}" requires a trusted provider`,
      );
    }
    const panelId = `eden.${category.id}`;
    if (this.panels.has(panelId)) return;
    this.registerGeneratedPanel(
      panelId,
      {
        id: "com.eden",
        name: category.name,
        description: category.description,
        icon: category.icon,
        settings: [category],
      },
      "eden",
    );
  }

  async listPanels(): Promise<SettingsPanelSummary[]> {
    const snapshot = this.activeSnapshot();
    if (!snapshot) return [];

    const summaries: SettingsPanelSummary[] = [];
    for (const record of this.panels.values()) {
      const declaration = authorizePanelDeclaration(record, snapshot.user);
      if (!declaration) continue;

      let icon = declaration.icon;
      if (record.source === "application" && record.ownerAppId) {
        icon = await this.appCatalog.getIcon(record.ownerAppId);
        if (!this.sameSession(snapshot)) return [];
      }
      summaries.push(
        cloneRendererValue({
          id: declaration.id,
          title: declaration.title,
          description: declaration.description,
          icon,
          source: declaration.source,
        }),
      );
    }
    return summaries;
  }

  async loadPanel(panelId: string): Promise<SettingsPanelResponse> {
    const snapshot = this.activeSnapshot();
    if (!snapshot) return { error: this.authorizationError() };

    const record = this.panels.get(panelId);
    if (!record) return { error: this.notFoundError() };
    const declaration = authorizePanelDeclaration(record, snapshot.user);
    if (!declaration) return { error: this.authorizationError() };

    const current = this.recheck(record, snapshot);
    if (!current) return { error: this.sessionChangedError() };

    try {
      const state = await this.executionContext.run(
        { principal: { kind: "user", profile: current.user } },
        () => record.provider.load(this.providerContext(record, current)),
      );
      if (!this.recheck(record, snapshot)) {
        return { error: this.sessionChangedError() };
      }
      const safeState = cloneRendererValue(state);
      return {
        panel: cloneRendererValue(declaration),
        state: applyActionAuthorization(
          record.renderer === "generic"
            ? { controls: safeState.controls }
            : safeState,
          declaration,
        ),
      };
    } catch (error) {
      log.warn(
        `Settings panel "${panelId}" loader failed: ${this.errorMessage(error)}`,
      );
      return {
        panel: cloneRendererValue(declaration),
        error: {
          code: "load_failed",
          message: "The settings panel could not be loaded.",
        },
      };
    }
  }

  async invokeAction(
    panelId: string,
    actionId: string,
    input: SettingsPanelValue | undefined,
  ): Promise<SettingsPanelActionResponse> {
    const snapshot = this.activeSnapshot();
    if (!snapshot) return { success: false, error: this.authorizationError() };

    const record = this.panels.get(panelId);
    if (!record) return { success: false, error: this.notFoundError() };
    if (!canOpenPanel(record, snapshot.user)) {
      return { success: false, error: this.authorizationError() };
    }

    const action = record.definition.actions?.find(
      (candidate) => candidate.id === actionId,
    );
    const handler = record.provider.actions?.[actionId];
    if (!action || !handler) {
      return {
        success: false,
        error: {
          code: "not_found",
          message: "The requested settings action does not exist.",
        },
      };
    }
    if (action.grant && !hasUserGrant(snapshot.user, action.grant)) {
      return { success: false, error: this.authorizationError() };
    }

    const failures = validatePanelActionInput(input, action.input);
    if (failures.length > 0) {
      return {
        success: false,
        error: {
          code: "validation",
          message: "The settings action input is invalid.",
          fields: Object.fromEntries(
            failures.map(({ path, message }) => [path, message]),
          ),
        },
      };
    }

    const current = this.recheck(record, snapshot);
    if (!current) {
      return { success: false, error: this.sessionChangedError() };
    }
    if (action.grant && !hasUserGrant(current.user, action.grant)) {
      return { success: false, error: this.authorizationError() };
    }
    try {
      const safeInput =
        input === undefined ? undefined : cloneRendererValue(input);
      await this.executionContext.run(
        { principal: { kind: "user", profile: current.user } },
        () => handler(safeInput, this.providerContext(record, current)),
      );
      if (!this.recheck(record, snapshot)) {
        return { success: false, error: this.sessionChangedError() };
      }
      return { success: true };
    } catch {
      // Action input is deliberately never included in diagnostics.
      log.warn(`Settings panel "${panelId}" action "${actionId}" failed`);
      return {
        success: false,
        error: {
          code: "action_failed",
          message: "The settings operation failed.",
        },
      };
    }
  }

  /** Return every grant declared by the current panel catalog. */
  listGrantOptions(): UserGrantOption[] {
    return collectPanelGrantOptions(this.panels.values());
  }

  private register(
    definition: InternalPanelDefinition,
    provider: SettingsPanelProvider,
    source: PanelSource,
    renderer: PanelRenderer,
    ownerAppId?: string,
    generatedSettings?: SettingsCategory[],
    visible = true,
  ): SettingsPanelRegistration {
    const cloned = cloneAndValidatePanelDefinition(definition);
    if (this.panels.has(cloned.id)) {
      throw new Error(`Settings panel "${cloned.id}" is already registered`);
    }
    validatePanelProvider(cloned, provider);
    const trustedProvider: SettingsPanelProvider = Object.freeze({
      load: provider.load.bind(provider),
      actions: Object.freeze(
        Object.fromEntries(
          Object.entries(provider.actions ?? {}).map(([id, handler]) => [
            id,
            handler.bind(provider),
          ]),
        ),
      ),
    });

    const token = Symbol(cloned.id);
    this.panels.set(cloned.id, {
      definition: cloned,
      provider: trustedProvider,
      source,
      renderer,
      ownerAppId,
      generatedSettings,
      token,
      visible,
    });
    this.notify("panels-changed", { reason: "catalog" });

    let active = true;
    const unregister = () => {
      if (!active) return;
      active = false;
      if (this.panels.get(cloned.id)?.token !== token) return;
      this.panels.delete(cloned.id);
      this.notify("panels-changed", { reason: "catalog" });
    };
    return Object.freeze({
      panelId: cloned.id,
      setVisible: (nextVisible: boolean) => {
        if (!active) {
          throw new Error(`Settings panel "${cloned.id}" is unregistered`);
        }
        const record = this.panels.get(cloned.id);
        if (!record || record.token !== token) {
          throw new Error(`Settings panel "${cloned.id}" is stale`);
        }
        if (record.visible === nextVisible) return;
        record.visible = nextVisible;
        this.notify("panels-changed", { reason: "visibility" });
      },
      unregister,
    });
  }

  private synchronizeManifestPanel(manifest: RuntimeAppManifest): void {
    this.removeManifestPanel(manifest.id);
    if (!manifest.settings?.length) return;
    try {
      this.registerGeneratedPanel(
        `app.${manifest.id}`,
        manifest,
        "application",
      );
    } catch (error) {
      log.warn(
        `Skipping invalid settings panel for app "${manifest.id}": ${this.errorMessage(error)}`,
      );
    }
  }

  private removeManifestPanel(appId: string): void {
    this.panels.delete(`app.${appId}`);
  }

  private registerGeneratedPanel(
    panelId: string,
    owner: GeneratedPanelOwner,
    source: "eden" | "application",
  ): void {
    const generated = createGeneratedSettingsPanel(
      panelId,
      owner,
      source,
      this.settingsManager,
      hasUserGrant,
    );
    this.register(
      generated.definition,
      generated.provider,
      source,
      "generic",
      generated.ownerAppId,
      generated.settings,
    );
  }

  private activeSnapshot():
    | { sessionId: string; user: UserProfile }
    | undefined {
    const user = this.sessionContext.getCurrentUser();
    if (!user) return undefined;
    return { sessionId: this.sessionContext.getSessionId(), user };
  }

  private sameSession(snapshot: {
    sessionId: string;
    user: UserProfile;
  }): boolean {
    const current = this.sessionContext.getCurrentUser();
    return (
      this.sessionContext.getSessionId() === snapshot.sessionId &&
      current?.username === snapshot.user.username &&
      current.role === snapshot.user.role &&
      current.updatedAt === snapshot.user.updatedAt &&
      current.grants.length === snapshot.user.grants.length &&
      current.grants.every(
        (grant, index) => grant === snapshot.user.grants[index],
      )
    );
  }

  private recheck(
    record: SettingsPanelRecord,
    snapshot: { sessionId: string; user: UserProfile },
  ): { sessionId: string; user: UserProfile } | undefined {
    if (this.panels.get(record.definition.id)?.token !== record.token) {
      return undefined;
    }
    if (!this.sameSession(snapshot)) return undefined;
    const user = this.sessionContext.getCurrentUser();
    if (!user || !canOpenPanel(record, user)) return undefined;
    return { sessionId: snapshot.sessionId, user };
  }

  private providerContext(
    record: SettingsPanelRecord,
    snapshot: { sessionId: string; user: UserProfile },
  ): SettingsPanelProviderContext {
    return {
      panelId: record.definition.id,
      sessionId: snapshot.sessionId,
      user: snapshot.user,
    };
  }

  private authorizationError(): SettingsPanelError {
    return {
      code: "authorization",
      message: "You are not authorized to access this settings panel.",
    };
  }

  private notFoundError(): SettingsPanelError {
    return {
      code: "not_found",
      message: "The requested settings panel does not exist.",
    };
  }

  private sessionChangedError(): SettingsPanelError {
    return {
      code: "session_changed",
      message: "The active session changed. Reload the settings panel.",
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : "Unknown error";
  }
}

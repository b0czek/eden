import type {
  RuntimeAppManifest,
  SettingsCategory,
  SettingsPanelActionInvocation,
  SettingsPanelActionResponse,
  SettingsPanelDefinition,
  SettingsPanelError,
  SettingsPanelProviderContext,
  SettingsPanelRegistration,
  SettingsPanelRegistrationOptions,
  SettingsPanelResponse,
  SettingsPanelSummary,
  SettingsPanelValue,
  SettingsPanelView,
  UserGrantOption,
  UserProfile,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { asError } from "../../effects/io";
import type { Event } from "../../events/event";
import { ExecutionContext } from "../../execution/context";
import { log } from "../../logging";
import { PackageCatalog } from "../../packages/catalog";
import { SessionContext } from "../../session/context";
import { Settings } from "../service";
import {
  actionAuthorization,
  applyActionAuthorization,
  canOpenPanel,
  collectPanelGrantOptions,
  hasUserGrant,
} from "./authorization";
import {
  cloneAndValidatePanelActionInvocation,
  cloneAndValidatePanelDefinition,
  cloneAndValidatePanelView,
  cloneRendererValue,
  type InternalPanelDefinition,
  isSettingsPanelViewValidationError,
  validatePanelProvider,
} from "./codec";
import { SettingsPanelRegistrationError } from "./errors";
import {
  createGeneratedSettingsPanel,
  type GeneratedPanelOwner,
} from "./generated";
import { PanelRegistryService, type SettingsPanelEvents } from "./registry";
import type {
  InternalSettingsPanelProvider,
  PanelRenderer,
  SettingsPanelRecord,
} from "./types";

export interface SettingsPanels {
  registerPanel: (
    definition: SettingsPanelDefinition,
    provider: InternalSettingsPanelProvider,
    options?: SettingsPanelRegistrationOptions,
  ) => SettingsPanelRegistration;
  registerBuiltinPanel: (
    definition: InternalPanelDefinition,
    provider: InternalSettingsPanelProvider,
    renderer?: PanelRenderer,
  ) => SettingsPanelRegistration;
  synchronizeManifestPanels: () => void;
  registerGeneratedBuiltinCategory: (category: SettingsCategory) => void;
  listPanels: () => Effect.Effect<SettingsPanelSummary[]>;
  loadPanel: (panelId: string) => Effect.Effect<SettingsPanelResponse>;
  invokeAction: (
    panelId: string,
    actionId: string,
    invocation: SettingsPanelActionInvocation,
  ) => Effect.Effect<SettingsPanelActionResponse>;
  listGrantOptions: () => UserGrantOption[];
  dispose: () => void;
  changed: Event<SettingsPanelEvents["panels-changed"]>;
  synchronizeManifestPanel: (manifest: RuntimeAppManifest) => void;
  removeManifestPanel: (appId: string) => void;
  invalidate: (
    reason: SettingsPanelEvents["panels-changed"]["reason"],
    panelId?: string,
  ) => void;
}

export const SettingsPanels = Context.Service<
  "eden/SettingsPanels",
  SettingsPanels
>("eden/SettingsPanels");

export const SettingsPanelsLive = Layer.effect(
  SettingsPanels,
  Effect.gen(function* () {
    const settings = yield* Settings;
    const packageCatalog = yield* PackageCatalog;
    const sessionContext = yield* SessionContext;
    const executionContext = yield* ExecutionContext;
    const registry = yield* PanelRegistryService;
    const { panels, changed, registerPanel, register } = registry;

    function registerBuiltinPanel(
      definition: InternalPanelDefinition,
      provider: InternalSettingsPanelProvider,
      renderer: PanelRenderer = "generic",
    ): SettingsPanelRegistration {
      const copied = cloneAndValidatePanelDefinition(definition);
      validatePanelProvider(copied, provider);
      if (!definition.id.startsWith("eden.")) {
        throw new SettingsPanelRegistrationError({
          panelId: definition.id,
          message: "Built-in panel IDs must begin with eden.",
        });
      }
      if (renderer !== "generic" && !definition.grant?.trim()) {
        throw new SettingsPanelRegistrationError({
          panelId: definition.id,
          message: "Custom settings panels require a panel grant",
        });
      }
      return register(copied, provider, "eden", renderer);
    }

    function synchronizeManifestPanels(): void {
      const liveIds = new Set<string>();
      for (const manifest of packageCatalog.allApps()) {
        if (!manifest.settings?.length) continue;
        liveIds.add(manifest.id);
        synchronizeManifestPanel(manifest);
      }

      for (const record of panels.values()) {
        if (
          record.source === "application" &&
          record.ownerAppId &&
          !liveIds.has(record.ownerAppId)
        ) {
          deletePanelTree(record.definition.id);
        }
      }
    }
    function registerGeneratedBuiltinCategory(
      category: SettingsCategory,
    ): void {
      if (category.view) {
        throw new SettingsPanelRegistrationError({
          panelId: `eden.${category.id}`,
          message: `Custom settings category "${category.id}" requires a trusted provider`,
        });
      }
      const panelId = `eden.${category.id}`;
      if (panels.has(panelId)) return;
      registerGeneratedPanel(
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
    const listPanels = Effect.fn(function* (): Effect.fn.Return<
      SettingsPanelSummary[]
    > {
      const snapshot = activeSnapshot();
      if (!snapshot) return [];

      const summaries: SettingsPanelSummary[] = [];
      for (const record of panels.values()) {
        if (!canOpen(record, snapshot.user)) continue;

        let icon = record.definition.icon;
        if (record.source === "application" && record.ownerAppId) {
          icon = yield* packageCatalog.getIcon(record.ownerAppId);
          if (!sameSession(snapshot)) return [];
        }
        summaries.push(
          cloneRendererValue({
            id: record.definition.id,
            parentId: record.definition.parentId,
            title: record.definition.title,
            description: record.definition.description,
            icon,
            source: record.source,
          }),
        );
      }
      return summaries;
    });
    const loadPanel = Effect.fn(function* (
      panelId: string,
    ): Effect.fn.Return<SettingsPanelResponse> {
      const snapshot = activeSnapshot();
      if (!snapshot) return { error: authorizationError() };
      const record = panels.get(panelId);
      if (!record) return { error: notFoundError() };
      if (!canOpen(record, snapshot.user))
        return { error: authorizationError() };
      const current = recheck(record, snapshot);
      if (!current) return { error: sessionChangedError() };
      return yield* Effect.gen(function* () {
        const loaded = yield* executionContext.provide(
          record.provider.load(providerContext(record, current)),
          { principal: { kind: "user", profile: current.user } },
        );
        return yield* Effect.try({
          try: () => {
            if (!recheck(record, snapshot)) {
              return { error: sessionChangedError() };
            }
            const actions = actionAuthorization(record, current.user);
            const metadata = {
              id: record.definition.id,
              parentId: record.definition.parentId,
              title: record.definition.title,
              description: record.definition.description,
              icon: record.definition.icon,
              source: record.source,
              actions,
            };
            if (record.renderer === "generic") {
              const view = cloneAndValidatePanelView(
                record.definition,
                loaded as SettingsPanelView,
              );
              const access = new Map(
                actions.map((action) => [action.id, action.authorized]),
              );
              return {
                panel: cloneRendererValue({
                  ...metadata,
                  renderer: "generic" as const,
                  view: applyActionAuthorization(view, access),
                }),
              };
            }
            const custom = cloneRendererValue(
              loaded as { data?: SettingsPanelValue },
            );
            return {
              panel: cloneRendererValue({
                ...metadata,
                renderer: record.renderer,
                data: custom.data,
              }),
            };
          },
          catch: asError,
        });
      }).pipe(
        Effect.catch((error) =>
          Effect.sync((): SettingsPanelResponse => {
            if (isSettingsPanelViewValidationError(error)) {
              return {
                error: {
                  code: "load_failed",
                  message: `The settings panel returned an invalid view at ${error.path}.`,
                  fields: { [error.path]: "This view value is invalid." },
                },
              };
            }
            log.warn(`Settings panel "${panelId}" loader failed`);
            return {
              error: {
                code: "load_failed",
                message: "The settings panel could not be loaded.",
              },
            };
          }),
        ),
      );
    });
    const invokeAction = Effect.fn(function* (
      panelId: string,
      actionId: string,
      invocation: SettingsPanelActionInvocation,
    ): Effect.fn.Return<SettingsPanelActionResponse> {
      const snapshot = activeSnapshot();
      if (!snapshot) return { success: false, error: authorizationError() };
      const record = panels.get(panelId);
      if (!record) return { success: false, error: notFoundError() };
      if (!canOpen(record, snapshot.user)) {
        return { success: false, error: authorizationError() };
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
        return { success: false, error: authorizationError() };
      }
      const validated = cloneAndValidatePanelActionInvocation(
        invocation,
        action,
      );
      const failures = validated.failures;
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
      const current = recheck(record, snapshot);
      if (!current) {
        return { success: false, error: sessionChangedError() };
      }
      if (action.grant && !hasUserGrant(current.user, action.grant)) {
        return { success: false, error: authorizationError() };
      }
      return yield* Effect.gen(function* () {
        yield* executionContext.provide(
          handler(validated.invocation, providerContext(record, current)),
          { principal: { kind: "user", profile: current.user } },
        );
        if (!recheck(record, snapshot)) {
          return { success: false, error: sessionChangedError() };
        }
        return { success: true };
      }).pipe(
        Effect.catch(() =>
          Effect.sync((): SettingsPanelActionResponse => {
            // Action input is deliberately never included in diagnostics.
            log.warn(`Settings panel "${panelId}" action "${actionId}" failed`);
            return {
              success: false,
              error: {
                code: "action_failed",
                message: "The settings operation failed.",
              },
            };
          }),
        ),
      );
    });
    function listGrantOptions(): UserGrantOption[] {
      return collectPanelGrantOptions(panels.values());
    }
    function synchronizeManifestPanel(manifest: RuntimeAppManifest): void {
      removeManifestPanel(manifest.id);
      if (!manifest.settings?.length) return;
      try {
        registerGeneratedPanel(`app.${manifest.id}`, manifest, "application");
      } catch (error) {
        log.warn(
          `Skipping invalid settings panel for app "${manifest.id}": ${errorMessage(error)}`,
        );
      }
    }
    function removeManifestPanel(appId: string): void {
      deletePanelTree(`app.${appId}`);
    }
    function deletePanelTree(panelId: string): void {
      for (const record of Array.from(panels.values())) {
        if (record.definition.parentId === panelId) {
          deletePanelTree(record.definition.id);
        }
      }
      panels.delete(panelId);
    }
    function registerGeneratedPanel(
      panelId: string,
      owner: GeneratedPanelOwner,
      source: "eden" | "application",
    ): void {
      const generated = createGeneratedSettingsPanel(
        panelId,
        owner,
        source,
        settings,
        hasUserGrant,
      );
      const definition = cloneAndValidatePanelDefinition(generated.definition);
      validatePanelProvider(definition, generated.provider);
      register(
        definition,
        generated.provider,
        source,
        "generic",
        generated.ownerAppId,
        generated.settings,
      );
    }
    function activeSnapshot():
      | { sessionId: string; user: UserProfile }
      | undefined {
      const user = sessionContext.getCurrentUser();
      if (!user) return undefined;
      return { sessionId: sessionContext.getSessionId(), user };
    }
    function sameSession(snapshot: {
      sessionId: string;
      user: UserProfile;
    }): boolean {
      const current = sessionContext.getCurrentUser();
      return (
        sessionContext.getSessionId() === snapshot.sessionId &&
        current?.username === snapshot.user.username &&
        current.role === snapshot.user.role &&
        current.updatedAt === snapshot.user.updatedAt &&
        current.grants.length === snapshot.user.grants.length &&
        current.grants.every(
          (grant, index) => grant === snapshot.user.grants[index],
        )
      );
    }
    function recheck(
      record: SettingsPanelRecord,
      snapshot: { sessionId: string; user: UserProfile },
    ): { sessionId: string; user: UserProfile } | undefined {
      if (panels.get(record.definition.id)?.token !== record.token) {
        return undefined;
      }
      if (!sameSession(snapshot)) return undefined;
      const user = sessionContext.getCurrentUser();
      if (!user || !canOpen(record, user)) return undefined;
      return { sessionId: snapshot.sessionId, user };
    }
    function providerContext(
      record: SettingsPanelRecord,
      snapshot: { sessionId: string; user: UserProfile },
    ): SettingsPanelProviderContext {
      return {
        panelId: record.definition.id,
        sessionId: snapshot.sessionId,
        user: snapshot.user,
      };
    }
    function ancestors(
      record: SettingsPanelRecord,
    ): SettingsPanelRecord[] | undefined {
      const ancestors: SettingsPanelRecord[] = [];
      let parentId = record.definition.parentId;
      while (parentId) {
        const parent = panels.get(parentId);
        if (!parent) return undefined;
        ancestors.push(parent);
        parentId = parent.definition.parentId;
      }
      return ancestors;
    }
    function canOpen(record: SettingsPanelRecord, user: UserProfile): boolean {
      const parents = ancestors(record);
      return !!parents && canOpenPanel(record, user, parents);
    }
    function authorizationError(): SettingsPanelError {
      return {
        code: "authorization",
        message: "You are not authorized to access this settings panel.",
      };
    }
    function notFoundError(): SettingsPanelError {
      return {
        code: "not_found",
        message: "The requested settings panel does not exist.",
      };
    }
    function sessionChangedError(): SettingsPanelError {
      return {
        code: "session_changed",
        message: "The active session changed. Reload the settings panel.",
      };
    }
    function errorMessage(error: unknown): string {
      return error instanceof Error ? error.message : "Unknown error";
    }
    return {
      registerPanel,
      registerBuiltinPanel,
      synchronizeManifestPanels,
      registerGeneratedBuiltinCategory,
      listPanels,
      loadPanel,
      invokeAction,
      listGrantOptions,
      dispose: registry.dispose,
      changed,
      synchronizeManifestPanel,
      removeManifestPanel,
      invalidate: (
        reason: SettingsPanelEvents["panels-changed"]["reason"],
        panelId?: string,
      ) => changed.emit({ reason, panelId }),
    };
  }),
);

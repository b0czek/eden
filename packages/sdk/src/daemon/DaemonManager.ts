import type {
  DaemonDefinition,
  DaemonRuntimeState,
  DaemonStatus,
  ExecutionPrincipal,
  RuntimeAppManifest,
  UserProfile,
} from "@edenapp/types";
import { inject, singleton } from "tsyringe";
import { AppCatalog } from "../app-registry";
import { ExecutionContext } from "../execution/ExecutionContext";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { PackageManager } from "../package-manager/PackageManager";
import { ProcessManager } from "../process-manager/ProcessManager";
import { SettingsManager } from "../settings";
import { EDEN_SETTINGS_APP_ID } from "../settings/SettingsManager";
import { UserManager } from "../user/UserManager";
import { DaemonHandler } from "./DaemonHandler";

interface DaemonNamespaceEvents {
  changed: { status: DaemonStatus };
}

interface RuntimeState {
  state: DaemonRuntimeState;
  restartCount: number;
  lastError?: string;
  nextRestartAt?: number;
  timer?: NodeJS.Timeout;
  stableTimer?: NodeJS.Timeout;
}

@singleton()
@EdenNamespace("daemon")
export class DaemonManager extends EdenEmitter<DaemonNamespaceEvents> {
  private static readonly KEY_PREFIX = "daemon.";
  private readonly loaded = new Map<string, DaemonDefinition>();
  private readonly runtime = new Map<string, RuntimeState>();
  private readonly supervised = new Set<string>();
  private readonly intentionalStops = new Set<string>();
  private shuttingDown = false;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(AppCatalog) private appCatalog: AppCatalog,
    @inject(ProcessManager) private processManager: ProcessManager,
    @inject(SettingsManager) private settingsManager: SettingsManager,
    @inject(UserManager) private userManager: UserManager,
    @inject(ExecutionContext) private executionContext: ExecutionContext,
    @inject(PackageManager) packageManager: PackageManager,
  ) {
    super(ipcBridge);
    commandRegistry.registerManager(new DaemonHandler(this));
    processManager.on("exited", ({ appId, code }) => {
      if (!this.supervised.delete(appId)) return;
      void this.handleExit(appId, code);
    });
    processManager.on("stopped", ({ appId }) => {
      const intentional = this.intentionalStops.delete(appId);
      const supervised = this.supervised.delete(appId);
      if (intentional) {
        this.setRuntime(appId, { state: "inactive", restartCount: 0 });
        return;
      }
      if (!supervised) return;
      void this.handleExit(appId, 1);
    });
    processManager.on("launched", ({ instance }) => {
      const appId = instance.manifest.id;
      if (
        !this.isDaemon(appId) ||
        instance.owner.kind !== "system" ||
        this.getRuntime(appId).state === "starting"
      ) {
        return;
      }
      this.supervised.add(appId);
      this.markActive(appId);
    });
    processManager.on("reloading", ({ appId }) => {
      if (this.isDaemon(appId)) {
        this.clearTimers(appId);
        this.intentionalStops.add(appId);
      }
    });
    packageManager.on("uninstalled", async ({ appId }) => {
      if (!this.isDaemon(appId)) return;
      this.clearTimers(appId);
      this.loaded.delete(appId);
      await this.settingsManager.delete(
        EDEN_SETTINGS_APP_ID,
        `${DaemonManager.KEY_PREFIX}${appId}`,
      );
    });
  }

  async initialize(): Promise<void> {
    await this.loadDefinitions();
    for (const definition of this.loaded.values()) {
      if (!definition.enabled) continue;
      try {
        await this.start(definition.appId);
      } catch (error) {
        this.markFailed(definition.appId, error);
        await this.handleExit(definition.appId, 1);
      }
    }
  }

  async list(): Promise<DaemonStatus[]> {
    const persisted = await this.readPersisted();
    return this.daemonApps().map((manifest) => {
      const definition =
        persisted.get(manifest.id) ??
        this.loaded.get(manifest.id) ??
        this.defaultDefinition(manifest.id);
      const runtime = this.getRuntime(manifest.id);
      const instance = this.processManager.getAppInstance(manifest.id);
      return {
        appId: manifest.id,
        name: manifest.name,
        definition,
        state: instance ? "active" : runtime.state,
        restartRequired:
          !!instance &&
          !this.samePrincipal(instance.principal, definition.runAs),
        instanceId: instance?.instanceId,
        restartCount: runtime.restartCount,
        lastError: runtime.lastError,
        nextRestartAt: runtime.nextRestartAt,
      };
    });
  }

  async updateDefinition(definition: DaemonDefinition): Promise<void> {
    const profile = await this.validateDefinition(definition);
    if (profile?.role === "vendor" && !this.executionContext.isVendor()) {
      throw new Error("Only a vendor can assign a vendor daemon principal");
    }
    await this.persist(definition);
    this.loaded.set(definition.appId, definition);
    await this.emitStatus(definition.appId);
  }

  private async loadDefinitions(): Promise<void> {
    const persisted = await this.readPersisted();
    for (const app of this.daemonApps()) {
      const definition =
        persisted.get(app.id) ?? this.defaultDefinition(app.id);
      try {
        await this.validateDefinition(definition);
        this.loaded.set(app.id, definition);
      } catch (error) {
        this.markFailed(app.id, error);
      }
    }
  }

  async setEnabled(appId: string, enabled: boolean): Promise<void> {
    this.requireDaemon(appId);
    const persisted = await this.readPersisted();
    const definition = persisted.get(appId) ?? this.defaultDefinition(appId);
    const updated = { ...definition, enabled };
    await this.validateDefinition(updated);
    await this.persist(updated);
    const loaded = this.loaded.get(appId);
    if (loaded) this.loaded.set(appId, { ...loaded, enabled });
    await this.emitStatus(appId);
  }

  async start(appId: string): Promise<void> {
    this.requireDaemon(appId);
    if (this.processManager.getAppInstance(appId)) return;
    const definition = this.loaded.get(appId) ?? this.defaultDefinition(appId);
    const profile = await this.validateDefinition(definition, true);
    if (!profile) {
      throw new Error(`Daemon ${appId} requires a runAs account`);
    }
    this.clearTimers(appId);
    this.setRuntime(appId, {
      ...this.getRuntime(appId),
      state: "starting",
      lastError: undefined,
      nextRestartAt: undefined,
    });
    try {
      this.supervised.add(appId);
      await this.processManager.launchDaemon(
        appId,
        { kind: "user", username: profile.username },
        profile,
      );
      this.markActive(appId);
    } catch (error) {
      this.supervised.delete(appId);
      this.markFailed(appId, error);
      throw error;
    }
  }

  async stop(appId: string): Promise<void> {
    this.requireDaemon(appId);
    this.clearTimers(appId);
    if (!this.processManager.getAppInstance(appId)) {
      this.setRuntime(appId, { state: "inactive", restartCount: 0 });
      return;
    }
    const supervised = this.supervised.has(appId);
    if (supervised) this.intentionalStops.add(appId);
    this.setRuntime(appId, { ...this.getRuntime(appId), state: "stopping" });
    try {
      await this.processManager.stopApp(appId);
      if (!supervised) {
        this.setRuntime(appId, { state: "inactive", restartCount: 0 });
      }
    } catch (error) {
      this.intentionalStops.delete(appId);
      this.markFailed(appId, error);
      throw error;
    }
  }

  async restart(appId: string): Promise<void> {
    if (this.processManager.getAppInstance(appId)) await this.stop(appId);
    await this.start(appId);
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    for (const app of this.daemonApps()) this.clearTimers(app.id);
  }

  private async handleExit(appId: string, code: number): Promise<void> {
    if (this.intentionalStops.has(appId) || this.shuttingDown) return;
    this.clearTimers(appId);
    const definition = this.loaded.get(appId) ?? this.defaultDefinition(appId);
    const shouldRestart =
      definition.restart === "always" ||
      (definition.restart === "on-failure" && code !== 0);
    if (!shouldRestart) {
      this.setRuntime(appId, {
        ...this.getRuntime(appId),
        state: code === 0 ? "inactive" : "failed",
        lastError: code === 0 ? undefined : `Exited with code ${code}`,
      });
      return;
    }
    const count = this.getRuntime(appId).restartCount + 1;
    const delay = Math.min(2 ** (count - 1), 30) * 1000;
    const nextRestartAt = Date.now() + delay;
    const runtime = this.setRuntime(appId, {
      state: "backoff",
      restartCount: count,
      lastError: `Exited with code ${code}`,
      nextRestartAt,
    });
    runtime.timer = setTimeout(() => {
      void this.start(appId).catch((error) => {
        log.error(`Failed to restart daemon ${appId}:`, error);
        void this.handleExit(appId, 1);
      });
    }, delay);
  }

  private daemonApps(): RuntimeAppManifest[] {
    return this.appCatalog
      .all()
      .filter((app) => !!app.backend?.entry && !app.frontend?.entry);
  }

  private isDaemon(appId: string): boolean {
    const app = this.appCatalog.get(appId);
    return !!app?.backend?.entry && !app.frontend?.entry;
  }

  private requireDaemon(appId: string): RuntimeAppManifest {
    const app = this.appCatalog.get(appId);
    if (!app?.backend?.entry || app.frontend?.entry) {
      throw new Error(`App ${appId} is not a backend-only daemon`);
    }
    return app;
  }

  private defaultDefinition(appId: string): DaemonDefinition {
    return {
      appId,
      enabled: false,
      runAs: null,
      restart: "on-failure",
    };
  }

  private samePrincipal(
    current: ExecutionPrincipal,
    configured: DaemonDefinition["runAs"],
  ): boolean {
    return (
      configured !== null &&
      current.kind === "user" &&
      current.username === configured.username
    );
  }

  private validateShape(definition: DaemonDefinition): void {
    if (!["never", "on-failure", "always"].includes(definition.restart)) {
      throw new Error(`Invalid restart policy for ${definition.appId}`);
    }
    if (definition.runAs && !definition.runAs.username.trim()) {
      throw new Error("runAs username is required");
    }
  }

  private async validateDefinition(
    definition: DaemonDefinition,
    requirePrincipal = definition.enabled,
  ): Promise<UserProfile | undefined> {
    this.requireDaemon(definition.appId);
    this.validateShape(definition);
    if (!definition.runAs) {
      if (requirePrincipal) {
        throw new Error(`Daemon ${definition.appId} requires a runAs account`);
      }
      return undefined;
    }
    return await this.resolveProfile(definition);
  }

  private async resolveProfile(
    definition: DaemonDefinition,
  ): Promise<UserProfile> {
    if (!definition.runAs) {
      throw new Error(`Daemon ${definition.appId} requires a runAs account`);
    }
    const profile = await this.userManager.getUser(definition.runAs.username);
    if (!profile) {
      throw new Error(
        `Daemon user ${definition.runAs.username} does not exist`,
      );
    }
    return profile;
  }

  private async readPersisted(): Promise<Map<string, DaemonDefinition>> {
    const result = new Map<string, DaemonDefinition>();
    const keys = await this.settingsManager.list(EDEN_SETTINGS_APP_ID, true);
    for (const key of keys) {
      if (!key.startsWith(DaemonManager.KEY_PREFIX)) continue;
      const value = await this.settingsManager.get(EDEN_SETTINGS_APP_ID, key);
      if (!value) continue;
      try {
        const definition = JSON.parse(value) as DaemonDefinition;
        if (definition.runAs?.kind !== "user") {
          definition.runAs = null;
          definition.enabled = false;
        }
        result.set(definition.appId, definition);
      } catch (error) {
        log.warn(`Invalid daemon definition ${key}:`, error);
      }
    }
    return result;
  }

  private async persist(definition: DaemonDefinition): Promise<void> {
    await this.settingsManager.set(
      EDEN_SETTINGS_APP_ID,
      `${DaemonManager.KEY_PREFIX}${definition.appId}`,
      JSON.stringify(definition),
    );
  }

  private getRuntime(appId: string): RuntimeState {
    return this.runtime.get(appId) ?? { state: "inactive", restartCount: 0 };
  }

  private setRuntime(appId: string, state: RuntimeState): RuntimeState {
    this.runtime.set(appId, state);
    void this.emitStatus(appId);
    return state;
  }

  private markFailed(appId: string, error: unknown): void {
    this.setRuntime(appId, {
      ...this.getRuntime(appId),
      state: "failed",
      lastError: error instanceof Error ? error.message : String(error),
    });
  }

  private markActive(appId: string): void {
    const runtime = this.setRuntime(appId, {
      ...this.getRuntime(appId),
      state: "active",
      lastError: undefined,
      nextRestartAt: undefined,
    });
    runtime.stableTimer = setTimeout(() => {
      this.setRuntime(appId, { state: "active", restartCount: 0 });
    }, 60_000);
  }

  private clearTimers(appId: string): void {
    const runtime = this.runtime.get(appId);
    if (runtime?.timer) clearTimeout(runtime.timer);
    if (runtime?.stableTimer) clearTimeout(runtime.stableTimer);
  }

  private async emitStatus(appId: string): Promise<void> {
    const status = (await this.list()).find((entry) => entry.appId === appId);
    if (status) this.notify("changed", { status });
  }
}

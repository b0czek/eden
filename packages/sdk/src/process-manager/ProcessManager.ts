import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import type {
  AppInstance,
  EdenConfig,
  ExecutionPrincipal,
  ProcessMetricsSnapshot,
  ProcessOwner,
  UserProfile,
} from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { AppCatalog } from "../app-registry";
import { AppChannelManager } from "../appbus/AppChannelManager";
import { ExecutionContext } from "../execution/ExecutionContext";
import { RuntimeContextRegistry } from "../execution/RuntimeContextRegistry";
import {
  getHotReloadServersPath,
  isHotReloadConfigured,
  loadHotReloadServerState,
} from "../hotreload-config";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { PackageManager } from "../package-manager/PackageManager";
import {
  PLATFORM_PROCESS_METRICS,
  type ProcessMetricsPort,
} from "../platform/ports";
import { SessionContext } from "../session/SessionContext";
import { ViewManager } from "../view-manager/ViewManager";
import { BackendManager } from "./BackendManager";
import { ProcessHandler } from "./ProcessHandler";
import { ProcessMetricsCollector } from "./ProcessMetricsCollector";

/**
 * Events emitted by the ProcessManager
 */
interface ProcessNamespaceEvents {
  launched: { instance: AppInstance };
  stopped: { appId: string };
  reloading: { appId: string };
  error: { appId: string; error: unknown };
  exited: { appId: string; code: number };
}

/**
 * ProcessManager
 *
 * Handles app lifecycle (launch, stop) and coordination between workers and views.
 */
@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("process")
export class ProcessManager extends EdenEmitter<ProcessNamespaceEvents> {
  private runningApps: Map<string, AppInstance> = new Map();
  private processHandler: ProcessHandler;
  private processMetrics: ProcessMetricsCollector;
  private loginAppId?: string;
  private hotReloadStates = new Map<string, string>();
  private hotReloadWatcher?: fs.FSWatcher;
  private hotReloadSetupPromise?: Promise<void>;
  private hotReloadDebounceTimer?: NodeJS.Timeout;
  private shuttingDown = false;

  constructor(
    @inject(BackendManager) private backendManager: BackendManager,
    @inject(ViewManager) private viewManager: ViewManager,
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(AppCatalog) private appCatalog: AppCatalog,
    @inject(PackageManager) private packageManager: PackageManager,
    @inject(AppChannelManager) private appChannelManager: AppChannelManager,
    @inject(SessionContext) private sessionContext: SessionContext,
    @inject(ExecutionContext) private executionContext: ExecutionContext,
    @inject("EdenConfig") private config: EdenConfig,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(RuntimeContextRegistry)
    private runtimeContexts: RuntimeContextRegistry,
    @inject(PLATFORM_PROCESS_METRICS) processMetrics: ProcessMetricsPort,
  ) {
    super(ipcBridge);
    this.loginAppId = this.config.loginAppId;
    this.processMetrics = new ProcessMetricsCollector({
      backendManager: this.backendManager,
      viewManager: this.viewManager,
      getRunningApps: (showHidden) => this.getRunningApps(showHidden),
      processMetrics,
    });

    this.setupEventHandlers();
    this.packageManager.on("uninstalled", async ({ appId }) => {
      if (this.runningApps.has(appId)) await this.stopApp(appId);
    });
    this.setupHotReloadWatcher();

    // Create and register handler
    this.processHandler = new ProcessHandler(this, this.executionContext);
    commandRegistry.registerManager(this.processHandler);
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Handle backend errors
    this.backendManager.on("backend-error", ({ appId, error }) => {
      log.error(`Backend error for app ${appId}:`, error);
      this.handleAppError(appId, error);
    });

    // Handle backend exits
    this.backendManager.on("backend-exit", ({ appId, code }) => {
      log.info(`Backend exited for app ${appId} with code ${code}`);
      this.handleAppExit(appId, code);
    });

    // Transfer backend port to frontend when view loads
    this.viewManager.on("view-loaded", ({ viewId, appId }) => {
      log.info(`View loaded for app ${appId}`);

      // If app has a backend, transfer the port to the frontend
      const backendPort = this.backendManager.getFrontendPort(appId);
      if (backendPort) {
        const viewInfo = this.viewManager.getViewInfo(viewId);
        if (viewInfo) {
          log.info(
            `Transferring backend port to view ${viewId} for app ${appId}`,
          );
          viewInfo.view.webContents.postMessage("backend-port", {}, [
            backendPort,
          ]);
          // Port has been transferred
        }
      } else {
        log.info(`No backend port for app ${appId} (may be frontend-only)`);
      }
    });
  }

  private setupHotReloadWatcher(): void {
    if (!isHotReloadConfigured(this.config)) {
      return;
    }

    const serversPath = getHotReloadServersPath(this.config);
    const stateDirectory = path.dirname(serversPath);
    const debounceMs = Math.max(this.config.hotReload?.debounce ?? 300, 50);

    this.hotReloadSetupPromise = fsp
      .mkdir(stateDirectory, { recursive: true })
      .then(() => {
        if (this.shuttingDown) return;
        this.hotReloadWatcher = fs.watch(
          stateDirectory,
          (eventType, filename) => {
            if (eventType !== "rename" && eventType !== "change") {
              return;
            }
            if (
              filename &&
              filename.toString() !== path.basename(serversPath)
            ) {
              return;
            }

            if (this.hotReloadDebounceTimer) {
              clearTimeout(this.hotReloadDebounceTimer);
            }
            this.hotReloadDebounceTimer = setTimeout(() => {
              void this.handleHotReloadStateChanged();
            }, debounceMs);
          },
        );

        void this.handleHotReloadStateChanged();
        log.info(`Watching hot reload state: ${serversPath}`);
      })
      .catch((error) => {
        if (!this.shuttingDown) {
          log.error(`Failed to watch hot reload state: ${serversPath}`, error);
        }
      });
  }

  private async handleHotReloadStateChanged(): Promise<void> {
    const state = await loadHotReloadServerState(this.config);
    const appIds = new Set([
      ...this.hotReloadStates.keys(),
      ...Object.keys(state.apps),
    ]);
    const nextStates = new Map<string, string>();

    for (const appId of appIds) {
      const appState = state.apps[appId];
      nextStates.set(
        appId,
        `${appState?.status}:${appState?.url}:${appState?.revision ?? 0}`,
      );
    }

    const changedAppIds = Array.from(appIds).filter(
      (appId) => this.hotReloadStates.get(appId) !== nextStates.get(appId),
    );

    this.hotReloadStates = nextStates;

    for (const appId of changedAppIds) {
      await this.refreshHotReloadApp(appId);
    }
  }

  private async refreshHotReloadApp(appId: string): Promise<void> {
    try {
      await this.packageManager.reloadApp(appId);
    } catch (error) {
      log.warn(`Failed to refresh hot reload manifest for ${appId}:`, error);
      return;
    }

    if (!this.runningApps.has(appId)) {
      return;
    }

    try {
      await this.reloadApp(appId);
    } catch (error) {
      log.error(`Failed to reload hot reload app ${appId}:`, error);
    }
  }

  /**
   * Launch an app
   */
  async launchApp(
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number },
    launchArgs?: string[],
  ): Promise<{ success: boolean; instanceId: string; appId: string }> {
    const developmentApp =
      this.config.development && this.appCatalog.get(appId)?.isDevelopment;
    if (
      !developmentApp &&
      !this.isLoginApp(appId) &&
      !this.executionContext.canLaunchApp(appId)
    ) {
      throw new Error(`User cannot launch app ${appId}`);
    }

    const currentUser = this.sessionContext.getCurrentUser();
    return await this.launchAppInternal(appId, bounds, launchArgs, {
      owner: {
        kind: "session",
        sessionId: this.sessionContext.getSessionId(),
        username: currentUser?.username ?? null,
      },
      principal: currentUser
        ? { kind: "user", username: currentUser.username }
        : { kind: "system" },
    });
  }

  async launchDaemon(
    appId: string,
    principal: ExecutionPrincipal,
    profile?: UserProfile,
  ): Promise<{ success: boolean; instanceId: string; appId: string }> {
    const manifest = this.appCatalog.get(appId);
    if (!manifest?.backend?.entry || manifest.frontend?.entry) {
      throw new Error(`App ${appId} is not a backend-only daemon`);
    }
    return await this.launchAppInternal(appId, undefined, undefined, {
      owner: { kind: "system" },
      principal,
      profile,
    });
  }

  private async launchAppInternal(
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number },
    launchArgs?: string[],
    runtime?: {
      owner: ProcessOwner;
      principal: ExecutionPrincipal;
      profile?: UserProfile;
    },
  ): Promise<{ success: boolean; instanceId: string; appId: string }> {
    const manifest = this.appCatalog.get(appId);
    if (!manifest) {
      throw new Error(`App ${appId} is not installed`);
    }

    // Validate manifest has at least frontend or backend
    if (!manifest.frontend?.entry && !manifest.backend?.entry) {
      throw new Error(
        `App ${appId} must have at least a frontend or backend entry`,
      );
    }

    // Check if already running
    if (this.runningApps.has(appId)) {
      throw new Error(`App ${appId} is already running`);
    }

    // Get the correct install path
    const installPath = this.appCatalog.getPath(appId);
    if (!installPath) {
      throw new Error(`App path not found for ${appId}`);
    }

    const instanceId = randomUUID();
    const currentUser = this.sessionContext.getCurrentUser();
    const resolvedRuntime: {
      owner: ProcessOwner;
      principal: ExecutionPrincipal;
      profile?: UserProfile;
    } = runtime ?? {
      owner: {
        kind: "session" as const,
        sessionId: this.sessionContext.getSessionId(),
        username: currentUser?.username ?? null,
      },
      principal: currentUser
        ? ({ kind: "user", username: currentUser.username } as const)
        : ({ kind: "system" } as const),
    };

    this.runtimeContexts.register(appId, {
      owner: resolvedRuntime.owner,
      principal: resolvedRuntime.principal,
      profile: resolvedRuntime.profile,
    });

    try {
      // Create backend utility process if one is defined
      if (manifest.backend?.entry) {
        await this.backendManager.createBackend(
          appId,
          manifest,
          installPath,
          launchArgs,
        );
      }

      // Create view for frontend only if frontend is defined
      let viewId: number | undefined;
      if (manifest.frontend?.entry) {
        viewId = this.viewManager.createView(
          appId,
          manifest,
          installPath,
          bounds,
          launchArgs,
        );
      }

      // Create app instance
      const instance: AppInstance = {
        manifest,
        instanceId,
        owner: resolvedRuntime.owner,
        principal: resolvedRuntime.principal,
        installPath,
        viewId: viewId ?? -1, // -1 indicates no view (backend-only)
        state: "running",
        installedAt: new Date(),
        lastLaunched: new Date(),
      };

      this.runningApps.set(appId, instance);
      this.syncRunningAppsState();

      this.notify("launched", { instance });

      // Return serializable data only
      return {
        success: true,
        instanceId,
        appId,
      };
    } catch (error) {
      this.runtimeContexts.unregister(appId);
      log.error(`Failed to launch app ${appId}:`, error);
      throw error;
    }
  }

  async ensureAppRunning(
    appId: string,
    options: {
      bounds?: { x: number; y: number; width: number; height: number };
      launchArgs?: string[];
    } = {},
  ): Promise<AppInstance> {
    const existing = this.runningApps.get(appId);
    if (existing) {
      return existing;
    }

    await this.launchApp(appId, options.bounds, options.launchArgs);

    const launched = this.runningApps.get(appId);
    if (!launched) {
      throw new Error(`App ${appId} failed to start`);
    }
    return launched;
  }

  /**
   * Stop a running app
   */
  async stopApp(appId: string): Promise<void> {
    const instance = this.runningApps.get(appId);
    if (!instance) {
      throw new Error(`App ${appId} is not running`);
    }

    try {
      // Unregister all services exposed by this app
      this.appChannelManager.unregisterAllServices(appId);

      // Remove view first (before backend termination to avoid race)
      if (instance.viewId !== -1) {
        this.viewManager.removeView(instance.viewId);
      }

      // Terminate backend after view is removed
      if (this.backendManager.hasBackend(appId)) {
        await this.backendManager.terminateBackend(appId);
      }

      // Remove from running apps
      this.runningApps.delete(appId);
      this.runtimeContexts.unregister(appId);
      this.syncRunningAppsState();

      this.notify("stopped", { appId });
    } catch (error) {
      log.error(`Failed to stop app ${appId}:`, error);
      throw error;
    }
  }

  /**
   * Get list of running apps
   * @param showHidden - If true, includes overlay apps and daemons (hidden by default)
   */
  getRunningApps(showHidden: boolean = false): AppInstance[] {
    const apps = Array.from(this.runningApps.values());
    return showHidden
      ? apps
      : apps.filter(
          (app) =>
            (app.manifest.hidden !== undefined
              ? !app.manifest.hidden
              : !app.manifest.overlay) && !!app.manifest.frontend?.entry,
        );
  }

  /**
   * Get app instance
   */
  getAppInstance(appId: string): AppInstance | undefined {
    return this.runningApps.get(appId);
  }

  getInstalledManifest(appId: string) {
    return this.appCatalog.get(appId);
  }

  /**
   * Return a process metrics snapshot for running Eden apps.
   *
   * CPU percentages are interval-based values supplied by Electron. To avoid
   * concurrent callers resetting each other's sampling window, the main process
   * owns a shared sampler with a fixed cadence and can keep it alive for slower
   * polling clients.
   */
  async getMetrics(
    showHidden: boolean = false,
    pollingTimeoutMs?: number,
    waitForAccurateCpu: boolean = true,
  ): Promise<ProcessMetricsSnapshot> {
    return await this.processMetrics.getMetrics(
      showHidden,
      pollingTimeoutMs,
      waitForAccurateCpu,
    );
  }

  /**
   * Sync running app IDs with the IPC bridge
   */
  private syncRunningAppsState(): void {
    this.ipcBridge.updateRunningApps(this.runningApps.keys());
  }

  /**
   * Handle app error
   */
  private handleAppError(appId: string, error: unknown): void {
    const instance = this.runningApps.get(appId);
    if (instance) {
      instance.state = "error";
      this.notify("error", { appId, error });
    }
  }

  /**
   * Handle app exit (called when backend crashes or exits unexpectedly)
   * Note: If stopApp() was called, the instance is already removed so this is a no-op
   */
  private handleAppExit(appId: string, code: number): void {
    const instance = this.runningApps.get(appId);
    if (!instance) {
      // App was already cleaned up by stopApp(), nothing to do
      return;
    }

    // Unregister all services exposed by this app
    this.appChannelManager.unregisterAllServices(appId);

    // Clean up view (only if frontend exists, viewId !== -1)
    if (instance.viewId !== -1) {
      try {
        this.viewManager.removeView(instance.viewId);
      } catch (_e) {
        // View may already be removed
      }
    }

    this.runningApps.delete(appId);
    this.runtimeContexts.unregister(appId);
    this.syncRunningAppsState();

    this.notify("exited", { appId, code });
  }

  /**
   * Shutdown all apps
   */
  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    await this.hotReloadSetupPromise;
    this.hotReloadWatcher?.close();
    if (this.hotReloadDebounceTimer) {
      clearTimeout(this.hotReloadDebounceTimer);
    }

    const runningAppIds = Array.from(this.runningApps.keys());

    log.info(`Stopping ${runningAppIds.length} running app(s)...`);

    // Stop all apps sequentially and wait for each to complete
    for (const appId of runningAppIds) {
      try {
        log.info(`Stopping app: ${appId}`);
        await this.stopApp(appId);
        log.info(`✓ Stopped app: ${appId}`);
      } catch (error) {
        log.error(`Failed to stop app ${appId}:`, error);
      }
    }
  }

  override dispose(): void {
    this.shuttingDown = true;
    this.hotReloadWatcher?.close();
    this.hotReloadWatcher = undefined;
    if (this.hotReloadDebounceTimer) {
      clearTimeout(this.hotReloadDebounceTimer);
      this.hotReloadDebounceTimer = undefined;
    }
    this.processMetrics.dispose();
    this.runningApps.clear();
    this.hotReloadStates.clear();
    super.dispose();
  }

  /**
   * Reload a running app
   */
  async reloadApp(appId: string): Promise<void> {
    const instance = this.runningApps.get(appId);
    if (!instance) {
      log.info(`App ${appId} is not running, skipping reload`);
      return;
    }

    // Save the current view bounds
    const viewInfo = this.viewManager.getViewInfo(instance.viewId);
    const bounds = viewInfo ? viewInfo.view.getBounds() : undefined;

    log.info(`Reloading app ${appId}...`);

    // A hot-reload watcher runs outside the request's AsyncLocalStorage
    // context. Preserve the running process identity before stopApp removes it
    // so relaunch does not depend on ambient user authorization state.
    const runtime = this.runtimeContexts.get(appId);

    // Stop the app
    if (instance.owner.kind === "system") {
      this.notify("reloading", { appId });
      await this.stopApp(appId);
      await this.launchDaemon(appId, instance.principal, runtime?.profile);
    } else {
      await this.stopApp(appId);

      // Small delay to ensure cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Relaunch with the same bounds and the identity of the process that was
      // already authorized to run.
      await this.launchAppInternal(appId, bounds, undefined, {
        owner: instance.owner,
        principal: instance.principal,
        profile: runtime?.profile,
      });
    }

    log.info(`App ${appId} reloaded successfully`);
  }

  async stopSessionApps(
    sessionId = this.sessionContext.getSessionId(),
  ): Promise<void> {
    const running = Array.from(this.runningApps.values())
      .filter(
        (instance) =>
          instance.owner.kind === "session" &&
          instance.owner.sessionId === sessionId,
      )
      .map((instance) => instance.manifest.id);
    const errors: unknown[] = [];
    for (const appId of running) {
      try {
        await this.stopApp(appId);
      } catch (error) {
        // A process may exit on its own after the snapshot was taken.
        if (this.runningApps.has(appId)) {
          errors.push(error);
        }
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to stop all session apps");
    }
  }

  private isLoginApp(appId: string): boolean {
    return !!this.loginAppId && appId === this.loginAppId;
  }
}

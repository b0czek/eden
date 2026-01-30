import { randomUUID } from "crypto";
import { BackendManager } from "./BackendManager";
import { ViewManager } from "../view-manager/ViewManager";
import { IPCBridge } from "../ipc";
import { PackageManager } from "../package-manager/PackageManager";
import { AppChannelManager } from "../appbus/AppChannelManager";
import type { AppInstance, EdenConfig } from "@edenapp/types";
import { injectable, inject, singleton } from "tsyringe";
import { CommandRegistry, EdenNamespace, EdenEmitter } from "../ipc";
import { ProcessHandler } from "./ProcessHandler";
import { UserManager } from "../user/UserManager";

/**
 * Events emitted by the ProcessManager
 */
interface ProcessNamespaceEvents {
  launched: { instance: AppInstance };
  stopped: { appId: string };
  error: { appId: string; error: any };
  exited: { appId: string; code: number };
}

/**
 * ProcessManager
 *
 * Handles app lifecycle (launch, stop) and coordination between workers and views.
 */
@singleton()
@injectable()
@EdenNamespace("process")
export class ProcessManager extends EdenEmitter<ProcessNamespaceEvents> {
  private runningApps: Map<string, AppInstance> = new Map();
  private processHandler: ProcessHandler;
  private loginAppId?: string;

  constructor(
    @inject(BackendManager) private backendManager: BackendManager,
    @inject(ViewManager) private viewManager: ViewManager,
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(PackageManager) private packageManager: PackageManager,
    @inject(AppChannelManager) private appChannelManager: AppChannelManager,
    @inject(UserManager) private userManager: UserManager,
    @inject("EdenConfig") config: EdenConfig,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
  ) {
    super(ipcBridge);
    this.loginAppId = config.loginAppId;

    this.setupEventHandlers();
    this.setupUserAccessHandlers();

    // Create and register handler
    this.processHandler = new ProcessHandler(this);
    commandRegistry.registerManager(this.processHandler);
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Handle backend errors
    this.backendManager.on("backend-error", ({ appId, error }) => {
      console.error(`Backend error for app ${appId}:`, error);
      this.handleAppError(appId, error);
    });

    // Handle backend exits
    this.backendManager.on("backend-exit", ({ appId, code }) => {
      console.log(`Backend exited for app ${appId} with code ${code}`);
      this.handleAppExit(appId, code);
    });

    // Transfer backend port to frontend when view loads
    // Subscribe via ipcBridge since ViewManager emits via EdenEmitter
    this.ipcBridge.eventSubscribers.subscribeInternal(
      "view/view-loaded",
      ({ viewId, appId }) => {
        console.log(`View loaded for app ${appId}`);

        // If app has a backend, transfer the port to the frontend
        const backendPort = this.backendManager.getFrontendPort(appId);
        if (backendPort) {
          const viewInfo = this.viewManager.getViewInfo(viewId);
          if (viewInfo) {
            console.log(
              `Transferring backend port to view ${viewId} for app ${appId}`,
            );
            viewInfo.view.webContents.postMessage("backend-port", {}, [
              backendPort,
            ]);
            // Port has been transferred
          }
        } else {
          console.log(
            `No backend port for app ${appId} (may be frontend-only)`,
          );
        }
      },
    );
  }

  private setupUserAccessHandlers(): void {
    this.ipcBridge.eventSubscribers.subscribeInternal(
      "user/changed",
      async ({ currentUser, previousUsername }) => {
        const currentUsername = currentUser?.username ?? null;
        if (currentUsername !== previousUsername) {
          await this.stopSessionApps();
        }
      },
    );
  }

  /**
   * Launch an app
   */
  async launchApp(
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number },
    launchArgs?: string[],
  ): Promise<{ success: boolean; instanceId: string; appId: string }> {
    if (!this.isLoginApp(appId) && !this.userManager.canLaunchApp(appId)) {
      throw new Error(`User cannot launch app ${appId}`);
    }

    const manifest = this.packageManager.getAppManifest(appId);
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
    const installPath = this.packageManager.getAppPath(appId);
    if (!installPath) {
      throw new Error(`App path not found for ${appId}`);
    }

    const instanceId = randomUUID();

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
      console.error(`Failed to launch app ${appId}:`, error);
      throw error;
    }
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
      this.syncRunningAppsState();

      this.notify("stopped", { appId });
    } catch (error) {
      console.error(`Failed to stop app ${appId}:`, error);
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

  /**
   * Sync running app IDs with the IPC bridge
   */
  private syncRunningAppsState(): void {
    this.ipcBridge.updateRunningApps(this.runningApps.keys());
  }

  /**
   * Handle app error
   */
  private handleAppError(appId: string, error: any): void {
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
      } catch (e) {
        // View may already be removed
      }
    }

    this.runningApps.delete(appId);
    this.syncRunningAppsState();

    this.notify("exited", { appId, code });
  }

  /**
   * Shutdown all apps
   */
  async shutdown(): Promise<void> {
    const runningAppIds = Array.from(this.runningApps.keys());

    console.log(`Stopping ${runningAppIds.length} running app(s)...`);

    // Stop all apps sequentially and wait for each to complete
    for (const appId of runningAppIds) {
      try {
        console.log(`Stopping app: ${appId}`);
        await this.stopApp(appId);
        console.log(`✓ Stopped app: ${appId}`);
      } catch (error) {
        console.error(`Failed to stop app ${appId}:`, error);
      }
    }
  }

  /**
   * Reload a running app
   */
  async reloadApp(appId: string): Promise<void> {
    const instance = this.runningApps.get(appId);
    if (!instance) {
      console.log(`App ${appId} is not running, skipping reload`);
      return;
    }

    // Save the current view bounds
    const viewInfo = this.viewManager.getViewInfo(instance.viewId);
    const bounds = viewInfo ? viewInfo.view.getBounds() : undefined;

    console.log(`Reloading app ${appId}...`);

    // Stop the app
    await this.stopApp(appId);

    // Small delay to ensure cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Relaunch with same bounds
    await this.launchApp(appId, bounds);

    console.log(`App ${appId} reloaded successfully`);
  }

  private async stopSessionApps(): Promise<void> {
    const running = Array.from(this.runningApps.keys());
    for (const appId of running) {
      try {
        await this.stopApp(appId);
      } catch (error) {
        console.error(`Failed to stop session app ${appId}:`, error);
      }
    }
  }

  private isLoginApp(appId: string): boolean {
    return !!this.loginAppId && appId === this.loginAppId;
  }
}

import { EventEmitter } from "events";
import * as path from "path";
import { randomUUID } from "crypto";
import { WorkerManager } from "./WorkerManager";
import { ViewManager } from "../view-manager/ViewManager";
import { IPCBridge } from "../core/IPCBridge";
import { PackageManager } from "../package-manager/PackageManager";
import { AppInstance, EventName, EventData, AppManifest } from "../../types";

/**
 * ProcessManager
 *
 * Handles app lifecycle (launch, stop) and coordination between workers and views.
 */
export class ProcessManager extends EventEmitter {
  private workerManager: WorkerManager;
  private viewManager: ViewManager;
  private ipcBridge: IPCBridge;
  private packageManager: PackageManager;
  private runningApps: Map<string, AppInstance> = new Map();
  private isShuttingDown: boolean = false;
  private appsDirectory: string;

  constructor(
    workerManager: WorkerManager,
    viewManager: ViewManager,
    ipcBridge: IPCBridge,
    packageManager: PackageManager,
    appsDirectory: string
  ) {
    super();
    this.workerManager = workerManager;
    this.viewManager = viewManager;
    this.ipcBridge = ipcBridge;
    this.packageManager = packageManager;
    this.appsDirectory = appsDirectory;

    this.setupEventHandlers();
  }

  /**
   * Type-safe event emitter
   */
  private emitEvent<T extends EventName>(
    event: T,
    data: EventData<T>
  ): boolean {
    return this.emit(event, data);
  }

  /**
   * Setup event handlers
   */
  private setupEventHandlers(): void {
    // Handle worker errors
    this.workerManager.on("worker-error", ({ appId, error }) => {
      console.error(`Worker error for app ${appId}:`, error);
      this.handleAppError(appId, error);
    });

    // Handle worker exits
    this.workerManager.on("worker-exit", ({ appId, code }) => {
      console.log(`Worker exited for app ${appId} with code ${code}`);
      this.handleAppExit(appId, code);
    });

    // Register per-app channels when a view loads
    this.viewManager.on(
      "view-loaded",
      ({ viewId, appId }: { viewId: number; appId: string }) => {
        console.log(`View loaded for app ${appId}, registering channels...`);

        // Register the per-app IPC channels
        this.ipcBridge.registerAppChannels(appId);

        // Send channel info to the view's preload
        const viewInfo = this.viewManager.getViewInfo(viewId);
        if (viewInfo) {
          const channel = `app-${appId}`;
          const requestChannel = `app-${appId}-request`;
          viewInfo.view.webContents.send("app/set-channel", {
            channel,
            requestChannel,
          });
          console.log(`Sent channel info to view ${viewId}: ${channel}`);
        }
      }
    );
  }

  /**
   * Launch an app
   */
  async launchApp(
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number }
  ): Promise<{ success: boolean; instanceId: string; appId: string }> {
    const manifest = this.packageManager.getAppManifest(appId);
    if (!manifest) {
      throw new Error(`App ${appId} is not installed`);
    }

    // Check if already running
    if (this.runningApps.has(appId)) {
      throw new Error(`App ${appId} is already running`);
    }

    const installPath = path.join(this.appsDirectory, appId);
    const instanceId = randomUUID();

    // Default bounds if not specified
    const viewBounds = bounds || { x: 0, y: 0, width: 800, height: 600 };

    try {
      // Create worker for backend if one is defined
      const worker = manifest.backend?.entry
        ? await this.workerManager.createWorker(appId, manifest, installPath)
        : null;

      // Create view for frontend
      const viewId = this.viewManager.createAppView(
        appId,
        manifest,
        installPath,
        viewBounds
      );

      // Create app instance
      const instance: AppInstance = {
        manifest,
        instanceId,
        installPath,
        worker,
        viewId,
        state: "running",
        installedAt: new Date(),
        lastLaunched: new Date(),
      };

      this.runningApps.set(appId, instance);
      this.syncRunningAppsState();

      this.emitEvent("process/launched", { instance });
      this.ipcBridge.systemBroadcast("app/launched", {
        appId,
        instanceId,
      });

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
      // Terminate worker if it exists
      if (this.workerManager.hasWorker(appId)) {
        await this.workerManager.terminateWorker(appId);
      }

      // Remove view
      this.viewManager.removeView(instance.viewId);

      // Unregister per-app IPC channels
      this.ipcBridge.unregisterAppChannels(appId);

      // Remove from running apps
      this.runningApps.delete(appId);
      this.syncRunningAppsState();

      this.emitEvent("process/stopped", { appId });

      // Only broadcast if not shutting down
      if (!this.isShuttingDown) {
        this.ipcBridge.systemBroadcast("app/stopped", { appId });
      }
    } catch (error) {
      console.error(`Failed to stop app ${appId}:`, error);
      throw error;
    }
  }

  /**
   * Get list of running apps
   */
  getRunningApps(): AppInstance[] {
    return Array.from(this.runningApps.values());
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
      this.emitEvent("process/error", { appId, error });
    }
  }

  /**
   * Handle app exit
   */
  private handleAppExit(appId: string, code: number): void {
    const instance = this.runningApps.get(appId);
    if (instance) {
      // Clean up view
      this.viewManager.removeView(instance.viewId);

      // Unregister per-app IPC channels
      this.ipcBridge.unregisterAppChannels(appId);

      this.runningApps.delete(appId);
      this.syncRunningAppsState();

      this.emitEvent("process/exited", { appId, code });
    }
  }

  /**
   * Shutdown all apps
   */
  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
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
   * Get status of all apps (installed and running)
   */
  getAllAppsStatus(): { installed: AppManifest[]; running: any[] } {
    const runningApps = this.getRunningApps().map((instance) => ({
      appId: instance.manifest.id,
      name: instance.manifest.name,
      version: instance.manifest.version,
      instanceId: instance.instanceId,
      state: instance.state,
      viewId: instance.viewId,
      installedAt: instance.installedAt,
      lastLaunched: instance.lastLaunched,
    }));
    return {
      installed: this.packageManager.getInstalledApps(),
      running: runningApps,
    };
  }
}

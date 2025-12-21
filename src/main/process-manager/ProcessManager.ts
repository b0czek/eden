import { EventEmitter } from "events";
import * as path from "path";
import { randomUUID } from "crypto";
import { Worker } from "worker_threads";
import { WorkerManager } from "./WorkerManager";
import { ViewManager } from "../view-manager/ViewManager";
import { IPCBridge } from "../ipc";
import { PackageManager } from "../package-manager/PackageManager";
import { AppInstance } from "@edenapp/types";
import { injectable, inject } from "tsyringe";
import { CommandRegistry, EdenNamespace, EdenEmitter } from "../ipc";
import { ProcessHandler } from "./ProcessHandler";

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
@injectable()
@EdenNamespace("process")
export class ProcessManager extends EdenEmitter<ProcessNamespaceEvents> {
  private workerManager: WorkerManager;
  private viewManager: ViewManager;
  private packageManager: PackageManager;
  private runningApps: Map<string, AppInstance> = new Map();
  private workers: Map<string, Worker> = new Map(); // Worker threads mapped by appId
  private appsDirectory: string;
  private processHandler: ProcessHandler;

  constructor(
    @inject("WorkerManager") workerManager: WorkerManager,
    @inject("ViewManager") viewManager: ViewManager,
    @inject("IPCBridge") ipcBridge: IPCBridge,
    @inject("PackageManager") packageManager: PackageManager,
    @inject("appsDirectory") appsDirectory: string,
    @inject("CommandRegistry") commandRegistry: CommandRegistry
  ) {
    super(ipcBridge);
    this.workerManager = workerManager;
    this.viewManager = viewManager;
    this.packageManager = packageManager;
    this.appsDirectory = appsDirectory;

    this.setupEventHandlers();

    // Create and register handler
    this.processHandler = new ProcessHandler(this);
    commandRegistry.registerManager(this.processHandler);
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
          viewInfo.view.webContents.send("app-set-channel", {
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
    bounds?: { x: number; y: number; width: number; height: number },
    launchArgs?: string[]
  ): Promise<{ success: boolean; instanceId: string; appId: string }> {
    const manifest = this.packageManager.getAppManifest(appId);
    if (!manifest) {
      throw new Error(`App ${appId} is not installed`);
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
      // Create worker for backend if one is defined
      if (manifest.backend?.entry) {
        const worker = await this.workerManager.createWorker(
          appId,
          manifest,
          installPath
        );
        this.workers.set(appId, worker);
      }

      // Create view for frontend
      let viewId: number;
      if (manifest.overlay) {
        viewId = this.viewManager.createOverlayView(
          appId,
          manifest,
          installPath,
          bounds,
          launchArgs
        );
      } else {
        viewId = this.viewManager.createAppView(
          appId,
          manifest,
          installPath,
          bounds || { x: 0, y: 0, width: 800, height: 600 },
          launchArgs
        );
      }

      // Create app instance
      const instance: AppInstance = {
        manifest,
        instanceId,
        installPath,
        viewId,
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
      // Terminate worker if it exists
      if (this.workerManager.hasWorker(appId)) {
        await this.workerManager.terminateWorker(appId);
        this.workers.delete(appId);
      }

      // Remove view
      this.viewManager.removeView(instance.viewId);

      // Unregister per-app IPC channels
      this.ipcBridge.unregisterAppChannels(appId);

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
   * @param showHidden - If true, includes overlay apps (hidden by default)
   */
  getRunningApps(showHidden: boolean = false): AppInstance[] {
    const apps = Array.from(this.runningApps.values());
    return showHidden ? apps : apps.filter((app) => !app.manifest.overlay);
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

      this.notify("exited", { appId, code });
    }
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
}

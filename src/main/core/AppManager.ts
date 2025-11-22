import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";
import AdmZip from "adm-zip";
import { WorkerManager } from "./WorkerManager";
import { ViewManager } from "../view-manager/ViewManager";
import { IPCBridge } from "./IPCBridge";
import { MouseTracker } from "../view-manager/MouseTracker";
import {
  AppManifest,
  AppInstance,
  AppManagerEventType,
  AppManagerEventData,
} from "../../types";
import { randomUUID } from "crypto";
import { CommandHandler, CommandNamespace } from "./CommandDecorators";

/**
 * AppManager
 *
 * Core manager for Eden apps.
 * Handles app installation, loading, lifecycle, and coordination
 * between workers and views.
 */
@CommandNamespace("app")
export class AppManager extends EventEmitter {
  private workerManager: WorkerManager;
  private viewManager: ViewManager;
  private ipcBridge: IPCBridge;
  private appsDirectory: string;
  private installedApps: Map<string, AppManifest> = new Map();
  private runningApps: Map<string, AppInstance> = new Map();
  private isShuttingDown: boolean = false;

  // mouse tracking
  private mouseTracker: MouseTracker;

  // Global drag/resize tracking
  private dragState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: { x: number; y: number; width: number; height: number };
  } | null = null;

  private resizeState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: { x: number; y: number; width: number; height: number };
    currentWidth: number;
    currentHeight: number;
  } | null = null;

  constructor(
    workerManager: WorkerManager,
    viewManager: ViewManager,
    ipcBridge: IPCBridge,
    appsDirectory: string
  ) {
    super();
    this.workerManager = workerManager;
    this.viewManager = viewManager;
    this.ipcBridge = ipcBridge;
    this.appsDirectory = appsDirectory;
    this.mouseTracker = new MouseTracker(8); // ~120fps

    this.setupEventHandlers();
  }

  /**
   * Type-safe event emitter
   */
  private emitEvent<T extends AppManagerEventType>(
    event: T,
    data: AppManagerEventData<T>
  ): boolean {
    return this.emit(event, data);
  }

  /**
   * Initialize the app manager
   */
  async initialize(): Promise<void> {
    // Ensure apps directory exists
    await fs.mkdir(this.appsDirectory, { recursive: true });

    // Load installed apps
    await this.loadInstalledApps();
    this.syncRunningAppsState();

    console.log(
      `AppManager initialized. Found ${this.installedApps.size} installed apps.`
    );
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
          viewInfo.view.webContents.send("set-app-channel", {
            channel,
            requestChannel,
          });
          console.log(`Sent channel info to view ${viewId}: ${channel}`);
        }
      }
    );
  }

  /**
   * Load all installed apps from disk
   */
  private async loadInstalledApps(): Promise<void> {
    try {
      const entries = await fs.readdir(this.appsDirectory, {
        withFileTypes: true,
      });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          try {
            const manifestPath = path.join(
              this.appsDirectory,
              entry.name,
              "manifest.json"
            );
            const manifestContent = await fs.readFile(manifestPath, "utf-8");
            const manifest: AppManifest = JSON.parse(manifestContent);

            this.installedApps.set(manifest.id, manifest);
          } catch (error) {
            console.warn(`Failed to load app from ${entry.name}:`, error);
          }
        }
      }
    } catch (error) {
      console.error("Failed to load installed apps:", error);
    }
  }

  /**
   * Install an app from a .edenite file
   */
  async installApp(edenitePath: string): Promise<AppManifest> {
    // Check if file exists
    try {
      await fs.access(edenitePath);
    } catch {
      throw new Error(`File not found: ${edenitePath}`);
    }

    // Check if it's a .edenite file
    if (!edenitePath.endsWith(".edenite")) {
      throw new Error(
        "Invalid file format. Please select a .edenite file.\n" +
          "You can create .edenite files using the genesis bundler:\n" +
          "  npm install -g @eden/genesis\n" +
          "  genesis build <app-directory>"
      );
    }

    // Extract the .edenite archive
    const zip = new AdmZip(edenitePath);
    const manifestEntry = zip.getEntry("manifest.json");

    if (!manifestEntry) {
      throw new Error("Invalid .edenite file: missing manifest.json");
    }

    // Read and validate manifest
    const manifestContent = zip.readAsText(manifestEntry);
    const manifest: AppManifest = JSON.parse(manifestContent);

    // Validate manifest
    this.validateManifest(manifest);

    // Check if already installed
    if (this.installedApps.has(manifest.id)) {
      throw new Error(
        `App ${manifest.id} is already installed.\n` +
          `Please uninstall the existing version first.`
      );
    }

    // Extract to apps directory
    const targetPath = path.join(this.appsDirectory, manifest.id);
    await fs.mkdir(targetPath, { recursive: true });

    zip.extractAllTo(targetPath, true);

    // Register app
    this.installedApps.set(manifest.id, manifest);

    this.emitEvent("app-installed", { manifest });
    this.ipcBridge.systemBroadcast("app-installed", { manifest });

    return manifest;
  }

  /**
   * Uninstall an app
   */
  async uninstallApp(appId: string): Promise<void> {
    const manifest = this.installedApps.get(appId);
    if (!manifest) {
      throw new Error(`App ${appId} is not installed`);
    }

    // Stop app if running
    if (this.runningApps.has(appId)) {
      await this.stopApp(appId);
    }

    // Remove from disk
    const appPath = path.join(this.appsDirectory, appId);
    await fs.rm(appPath, { recursive: true, force: true });

    // Unregister
    this.installedApps.delete(appId);

    this.emitEvent("app-uninstalled", { appId });
    this.ipcBridge.systemBroadcast("app-uninstalled", { appId });
  }

  /**
   * Launch an app
   */
  async launchApp(
    appId: string,
    bounds?: { x: number; y: number; width: number; height: number }
  ): Promise<{ success: boolean; instanceId: string; appId: string }> {
    const manifest = this.installedApps.get(appId);
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

      this.emitEvent("app-launched", { instance });
      this.ipcBridge.systemBroadcast("app-launched", {
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

      this.emitEvent("app-stopped", { appId });

      // Only broadcast if not shutting down
      if (!this.isShuttingDown) {
        this.ipcBridge.systemBroadcast("app-stopped", { appId });
      }
    } catch (error) {
      console.error(`Failed to stop app ${appId}:`, error);
      throw error;
    }
  }

  /**
   * Get list of installed apps
   */
  getInstalledApps(): AppManifest[] {
    return Array.from(this.installedApps.values());
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
   * Validate app manifest
   */
  private validateManifest(manifest: AppManifest): void {
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error(
        "Invalid manifest: missing required fields (id, name, version)"
      );
    }

    if (!manifest.frontend?.entry) {
      throw new Error("Invalid manifest: missing frontend.entry");
    }

    if (manifest.backend && !manifest.backend.entry) {
      throw new Error(
        "Invalid manifest: backend.entry must be specified when backend is defined"
      );
    }
  }

  /**
   * Copy directory recursively
   */
  private async copyDirectory(src: string, dest: string): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Handle app error
   */
  private handleAppError(appId: string, error: any): void {
    const instance = this.runningApps.get(appId);
    if (instance) {
      instance.state = "error";
      this.emitEvent("app-error", { appId, error });
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

      this.emitEvent("app-exited", { appId, code });
    }
  }


  /**
   * Command Handlers (decorated)
   */

  @CommandHandler("launch")
  async handleLaunchApp(
    args: { appId: string; bounds?: { x: number; y: number; width: number; height: number } }
  ): Promise<any> {
    const { appId, bounds } = args;
    return await this.launchApp(appId, bounds);
  }

  @CommandHandler("stop")
  async handleStopApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    await this.stopApp(appId);
    return { success: true };
  }

  @CommandHandler("install")
  async handleInstallApp(
    args: { sourcePath: string }
  ): Promise<any> {
    const { sourcePath } = args;
    return await this.installApp(sourcePath);
  }

  @CommandHandler("uninstall")
  async handleUninstallApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    await this.uninstallApp(appId);
    return { success: true };
  }

  @CommandHandler("list")
  async handleListApps(
    args: Record<string, never>
  ): Promise<any> {
    // Serialize running apps to avoid cloning issues
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
      installed: this.getInstalledApps(),
      running: runningApps,
    };
  }

  @CommandHandler("update-view-bounds")
  async handleUpdateViewBounds(
    args: { appId: string; bounds: { x: number; y: number; width: number; height: number } }
  ): Promise<any> {
    const { appId, bounds } = args;
    
    // Check if it's a regular app
    const instance = this.getAppInstance(appId);
    if (instance) {
      const success = this.viewManager.setViewBounds(instance.viewId, bounds);
      return { success };
    }
    
    // Check if it's a view (app or overlay) by appId
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length > 0) {
      // Use the first view (typically there's only one per appId)
      const success = this.viewManager.setViewBounds(viewIds[0], bounds);
      return { success };
    }
    
    throw new Error(`App or view ${appId} is not running`);
  }

  @CommandHandler("set-view-visibility")
  async handleSetViewVisibility(
    args: { appId: string; visible: boolean }
  ): Promise<any> {
    const { appId, visible } = args;
    const instance = this.getAppInstance(appId);
    if (!instance) {
      throw new Error(`App ${appId} is not running`);
    }
    const success = visible
      ? this.viewManager.showView(instance.viewId)
      : this.viewManager.hideView(instance.viewId);
    return { success };
  }

  @CommandHandler("focus-app")
  async handleFocusApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    const instance = this.getAppInstance(appId);
    if (!instance) {
      throw new Error(`App ${appId} is not running`);
    }
    const success = this.viewManager.bringToFront(instance.viewId);
    return { success };
  }

  @CommandHandler("update-workspace-bounds")
  async handleUpdateWorkspaceBounds(
    args: { bounds: { x: number; y: number; width: number; height: number } }
  ): Promise<any> {
    const { bounds } = args;
    this.viewManager.setWorkspaceBounds(bounds);
    
    // Notify all views (especially overlays) about workspace bounds change
    // Overlays can recalculate their desired position and send update-view-bounds
    this.ipcBridge.systemBroadcast("workspace-bounds-changed", {
      bounds,
    });
    
    return { success: true };
  }

  @CommandHandler("toggle-view-mode")
  async handleToggleViewMode(
    args: { appId: string; mode?: "floating" | "tiled" }
  ): Promise<any> {
    const { appId, mode } = args;
    const instance = this.getAppInstance(appId);
    if (!instance) {
      throw new Error(`App ${appId} is not running`);
    }
    const success = this.viewManager.setViewMode(instance.viewId, mode);
    return { success };
  }

  @CommandHandler("start-drag")
  async handleStartDrag(
    args: { appId: string; startX: number; startY: number }
  ): Promise<any> {
    const { appId, startX, startY } = args;
    const instance = this.getAppInstance(appId);
    if (!instance) {
      throw new Error(`App ${appId} is not running`);
    }

    // Get current view bounds
    const viewInfo = this.viewManager.getViewInfo(instance.viewId);
    if (!viewInfo) {
      throw new Error(`View ${instance.viewId} not found`);
    }

    // Stop any existing drag
    if (this.dragState) {
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
    }

    // Start tracking global mouse position
    this.dragState = {
      appId,
      startX,
      startY,
      startBounds: { ...viewInfo.bounds },
    };

    // Subscribe to mouse updates
    this.mouseTracker.subscribe(`drag-${appId}`, (position) => {
      if (!this.dragState) return;

      const deltaX = position.x - this.dragState.startX;
      const deltaY = position.y - this.dragState.startY;

      const newBounds = {
        x: this.dragState.startBounds.x + deltaX,
        y: this.dragState.startBounds.y + deltaY,
        width: this.dragState.startBounds.width,
        height: this.dragState.startBounds.height,
      };

      this.viewManager.setViewBounds(instance.viewId, newBounds);

      // Notify renderer of bounds update so it stays in sync
      const view = this.viewManager.getView(instance.viewId);
      if (view) {
        view.webContents.send("bounds-updated", newBounds);
      }
    });

    return { success: true };
  }

  @CommandHandler("end-drag")
  async handleEndDrag(
    args: { appId: string }
  ): Promise<any> {
    if (this.dragState) {
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
      this.dragState = null;
    }
    return { success: true };
  }

  @CommandHandler("global-mouseup")
  async handleGlobalMouseUp(): Promise<any> {
    // Cleanup any active drag or resize operations when mouse is released
    // This is called by the shell window which covers the entire screen
    if (this.dragState) {
      console.log("[AppManager] Global mouseup - cleaning up drag state");
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
      this.dragState = null;
    }
    if (this.resizeState) {
      console.log("[AppManager] Global mouseup - cleaning up resize state");
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
      this.resizeState = null;
    }
    return { success: true };
  }

  @CommandHandler("start-resize")
  async handleStartResize(
    args: { appId: string; startX: number; startY: number }
  ): Promise<any> {
    const { appId, startX, startY } = args;
    const instance = this.getAppInstance(appId);
    if (!instance) {
      throw new Error(`App ${appId} is not running`);
    }

    // Get current view bounds
    const viewInfo = this.viewManager.getViewInfo(instance.viewId);
    if (!viewInfo) {
      throw new Error(`View ${instance.viewId} not found`);
    }

    // Stop any existing resize
    if (this.resizeState) {
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
    }

    // Initialize resize state with smoothing variables
    this.resizeState = {
      appId,
      startX,
      startY,
      startBounds: { ...viewInfo.bounds },
      currentWidth: viewInfo.bounds.width,
      currentHeight: viewInfo.bounds.height,
    };

    // Subscribe to mouse updates
    this.mouseTracker.subscribe(`resize-${appId}`, (position) => {
      if (!this.resizeState) return;

      const deltaX = position.x - this.resizeState.startX;
      const deltaY = position.y - this.resizeState.startY;

      let targetWidth = this.resizeState.startBounds.width + deltaX;
      let targetHeight = this.resizeState.startBounds.height + deltaY;

      // Apply minimum size
      targetWidth = Math.max(targetWidth, 200);
      targetHeight = Math.max(targetHeight, 200);

      // Smooth interpolation for more fluid resize (lerp factor based on frame time)
      // const smoothingFactor = Math.min(1, (position.deltaTime / 16) * 1); // Adaptive smoothing
      // this.resizeState.currentWidth +=
      //   (targetWidth - this.resizeState.currentWidth) * smoothingFactor;
      // this.resizeState.currentHeight +=
      //   (targetHeight - this.resizeState.currentHeight) * smoothingFactor;

      this.resizeState.currentWidth = targetWidth;
      this.resizeState.currentHeight = targetHeight;

      const newBounds = {
        x: this.resizeState.startBounds.x,
        y: this.resizeState.startBounds.y,
        width: Math.round(this.resizeState.currentWidth),
        height: Math.round(this.resizeState.currentHeight),
      };

      this.viewManager.setViewBounds(instance.viewId, newBounds);

      // Notify renderer of bounds update so it stays in sync
      const view = this.viewManager.getView(instance.viewId);
      if (view) {
        view.webContents.send("bounds-updated", newBounds);
      }
    });

    return { success: true };
  }

  @CommandHandler("end-resize")
  async handleEndResize(
    args: { appId: string }
  ): Promise<any> {
    if (this.resizeState) {
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
      this.resizeState = null;
    }
    return { success: true };
  }

  @CommandHandler("get-window-size")
  async handleGetWindowSize(
    args: Record<string, never>
  ): Promise<any> {
    // Get main window size from ipcBridge or eden instance
    const mainWindow = this.ipcBridge.getMainWindow();
    if (!mainWindow) {
      throw new Error("Main window not available");
    }

    const windowBounds = mainWindow.getBounds();
    return {
      width: windowBounds.width,
      height: windowBounds.height,
    };
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
        console.error(`✗ Error stopping app ${appId} during shutdown:`, error);
      }
    }

    // Cleanup mouse tracker
    this.mouseTracker.dispose();

    // Give a brief moment for any async cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log("All apps stopped");
  }
}

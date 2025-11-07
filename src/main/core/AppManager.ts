import { EventEmitter } from "events";
import * as fs from "fs/promises";
import * as path from "path";
import AdmZip from "adm-zip";
import { WorkerManager } from "./WorkerManager";
import { ViewManager } from "./ViewManager";
import { IPCBridge } from "./IPCBridge";
import { AppManifest, AppInstance } from "../../types";
import { randomUUID } from "crypto";

/**
 * AppManager
 *
 * Core manager for Eden apps.
 * Handles app installation, loading, lifecycle, and coordination
 * between workers and views.
 */
export class AppManager extends EventEmitter {
  private workerManager: WorkerManager;
  private viewManager: ViewManager;
  private ipcBridge: IPCBridge;
  private appsDirectory: string;
  private installedApps: Map<string, AppManifest> = new Map();
  private runningApps: Map<string, AppInstance> = new Map();
  private isShuttingDown: boolean = false;

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

    this.setupEventHandlers();
  }

  /**
   * Initialize the app manager
   */
  async initialize(): Promise<void> {
    // Ensure apps directory exists
    await fs.mkdir(this.appsDirectory, { recursive: true });

    // Load installed apps
    await this.loadInstalledApps();

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

    // Handle shell commands from IPC
    this.ipcBridge.on("shell-command", async ({ command, args, commandId }) => {
      try {
        const result = await this.handleShellCommand(command, args);
        this.ipcBridge.respondToCommand(commandId, result);
      } catch (error: any) {
        this.ipcBridge.respondToCommand(commandId, null, error);
      }
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

    this.emit("app-installed", { manifest });
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

    this.emit("app-uninstalled", { appId });
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
      // Create worker for backend
      const worker = await this.workerManager.createWorker(
        appId,
        manifest,
        installPath
      );

      // Create view for frontend
      const viewId = this.viewManager.createView(
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

      this.emit("app-launched", { instance });
      this.ipcBridge.systemBroadcast("app-launched", { appId, instanceId });

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
      // Terminate worker
      await this.workerManager.terminateWorker(appId);

      // Remove view
      this.viewManager.removeView(instance.viewId);

      // Unregister per-app IPC channels
      this.ipcBridge.unregisterAppChannels(appId);

      // Remove from running apps
      this.runningApps.delete(appId);

      this.emit("app-stopped", { appId });

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
   * Validate app manifest
   */
  private validateManifest(manifest: AppManifest): void {
    if (!manifest.id || !manifest.name || !manifest.version) {
      throw new Error(
        "Invalid manifest: missing required fields (id, name, version)"
      );
    }

    if (!manifest.backend?.entry) {
      throw new Error("Invalid manifest: missing backend.entry");
    }

    if (!manifest.frontend?.entry) {
      throw new Error("Invalid manifest: missing frontend.entry");
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
      this.emit("app-error", { appId, error });
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

      this.emit("app-exited", { appId, code });
    }
  }

  /**
   * Handle shell commands
   */
  private async handleShellCommand(command: string, args: any): Promise<any> {
    try {
      switch (command) {
        case "launch-app":
          return await this.launchApp(args.appId, args.bounds);
        case "stop-app":
          await this.stopApp(args.appId);
          return { success: true };
        case "install-app":
          return await this.installApp(args.sourcePath);
        case "uninstall-app":
          await this.uninstallApp(args.appId);
          return { success: true };
        case "list-apps":
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
        case "update-view-bounds":
          const instance = this.getAppInstance(args.appId);
          if (!instance) {
            throw new Error(`App ${args.appId} is not running`);
          }
          const success = this.viewManager.setViewBounds(
            instance.viewId,
            args.bounds
          );
          return { success };
        case "set-view-visibility":
          const visibilityInstance = this.getAppInstance(args.appId);
          if (!visibilityInstance) {
            throw new Error(`App ${args.appId} is not running`);
          }
          const visibilitySuccess = args.visible
            ? this.viewManager.showView(visibilityInstance.viewId)
            : this.viewManager.hideView(visibilityInstance.viewId);
          return { success: visibilitySuccess };
        case "focus-app":
          const focusInstance = this.getAppInstance(args.appId);
          if (!focusInstance) {
            throw new Error(`App ${args.appId} is not running`);
          }
          const focusSuccess = this.viewManager.bringToFront(
            focusInstance.viewId
          );
          return { success: focusSuccess };
        default:
          console.warn(`Unknown shell command: ${command}`);
          return { error: "Unknown command" };
      }
    } catch (error) {
      console.error(`Error handling shell command ${command}:`, error);
      this.emit("command-error", { command, error });
      throw error;
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
        console.error(`✗ Error stopping app ${appId} during shutdown:`, error);
      }
    }

    // Give a brief moment for any async cleanup
    await new Promise((resolve) => setTimeout(resolve, 100));

    console.log("All apps stopped");
  }
}

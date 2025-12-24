import "reflect-metadata";
import { app, BrowserWindow } from "electron";
import * as path from "path";
import { IPCBridge, CommandRegistry, PermissionRegistry } from "./ipc";
import { SystemHandler } from "./SystemHandler";
import { EdenConfig, AppManifest } from "../types";

// Managers and Handlers
import { PackageManager, PackageHandler } from "./package-manager";
import {
  ProcessManager,
  ProcessHandler,
  WorkerManager,
  AutostartManager,
} from "./process-manager";
import { ViewManager, ViewHandler } from "./view-manager";
import { FilesystemManager } from "./filesystem";
import { FileOpenManager } from "./file-open";
import { NotificationManager } from "./notification";
import { container } from "tsyringe";

export class Eden {
  private mainWindow: BrowserWindow | null = null;
  private workerManager: WorkerManager;
  private viewManager: ViewManager;
  private ipcBridge: IPCBridge;
  private commandRegistry: CommandRegistry;
  private appsDirectory: string;
  private userDirectory: string;
  private config: EdenConfig;

  // New components
  private packageManager: PackageManager;
  private processManager: ProcessManager;
  private systemHandler: SystemHandler;
  private filesystemManager: FilesystemManager;
  private permissionRegistry: PermissionRegistry;
  private fileOpenManager: FileOpenManager;
  private autostartManager: AutostartManager;
  private notificationManager: NotificationManager;

  constructor(config: EdenConfig = {}) {
    this.config = config;

    app.commandLine.appendSwitch("enable-features", "V8CodeCache");

    // Set apps directory to user data + /eden-apps or custom path
    this.appsDirectory =
      config.appsDirectory || path.join(app.getPath("userData"), "eden-apps");

    // Set user directory to user data + /eden-user or custom path
    this.userDirectory =
      config.userDirectory || path.join(app.getPath("userData"), "eden-user");

    // Initialize core managers
    // 1. Command Registry (required by others)
    this.commandRegistry = new CommandRegistry();
    container.registerInstance("CommandRegistry", this.commandRegistry);

    // 2. Permission Registry
    this.permissionRegistry = new PermissionRegistry();
    container.registerInstance("PermissionRegistry", this.permissionRegistry);

    // Wire permission registry to command registry
    this.commandRegistry.setPermissionRegistry(this.permissionRegistry);

    // Register Config
    container.registerInstance("EdenConfig", this.config);

    // 2. Worker Manager
    this.workerManager = new WorkerManager();
    container.registerInstance("WorkerManager", this.workerManager);

    // 3. IPC Bridge (depends on WorkerManager, CommandRegistry)
    // Note: ViewManager is not passed yet, will be set later
    this.ipcBridge = new IPCBridge(this.workerManager, this.commandRegistry);
    container.registerInstance("IPCBridge", this.ipcBridge);

    // 4. ViewManager (depends on CommandRegistry, IPCBridge, EdenConfig)
    this.viewManager = container.resolve(ViewManager);
    container.registerInstance("ViewManager", this.viewManager);

    // 5. Break circular dependency: Set ViewManager on IPCBridge
    this.ipcBridge.setViewManager(this.viewManager);

    // Wire permission registry to event subscriber manager
    this.ipcBridge.eventSubscribers.setPermissionRegistry(
      this.permissionRegistry
    );

    // Register appsDirectory for injection
    container.registerInstance("appsDirectory", this.appsDirectory);

    // Initialize Package Manager
    this.packageManager = container.resolve(PackageManager);
    container.registerInstance("PackageManager", this.packageManager);

    // Initialize Process Manager
    this.processManager = container.resolve(ProcessManager);
    container.registerInstance("ProcessManager", this.processManager);

    // Initialize System Handler
    this.systemHandler = container.resolve(SystemHandler);
    container.registerInstance("SystemHandler", this.systemHandler);

    // Register userDirectory for injection
    container.registerInstance("userDirectory", this.userDirectory);

    // Initialize Filesystem Manager
    this.filesystemManager = container.resolve(FilesystemManager);
    container.registerInstance("FilesystemManager", this.filesystemManager);

    // Initialize File Open Manager
    this.fileOpenManager = container.resolve(FileOpenManager);
    container.registerInstance("FileOpenManager", this.fileOpenManager);

    // Initialize Autostart Manager
    this.autostartManager = container.resolve(AutostartManager);
    container.registerInstance("AutostartManager", this.autostartManager);

    // Initialize Notification Manager
    this.notificationManager = container.resolve(NotificationManager);
    container.registerInstance("NotificationManager", this.notificationManager);

    this.setupAppEventHandlers();
  }

  /**
   * Setup Electron app event handlers
   */
  private setupAppEventHandlers(): void {
    app.on("ready", () => this.onReady());
    app.on("window-all-closed", () => this.onWindowAllClosed());
    app.on("activate", () => this.onActivate());
    app.on("before-quit", () => this.onBeforeQuit());
  }

  /**
   * Handle app ready event
   */
  private async onReady(): Promise<void> {
    console.log("Eden starting...");

    // Initialize package manager
    await this.packageManager.initialize();

    // Initialize file open manager (load user preferences)
    await this.fileOpenManager.initialize();

    // Create main window
    this.createMainWindow();

    console.log("Eden ready!");
  }

  /**
   * Create the main Eden window with foundation layer
   */
  private createMainWindow(): void {
    const windowConfig = this.config.window || {};

    this.mainWindow = new BrowserWindow({
      width: windowConfig.width || 1280,
      height: windowConfig.height || 800,
      title: windowConfig.title || "Eden",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(__dirname, "../foundation/foundation-preload.js"),
      },
      backgroundColor: windowConfig.backgroundColor || "#1e1e1e",
      autoHideMenuBar: true,
      show: false, // Don't show until ready
    });

    // Set managers to use this window
    this.viewManager.setMainWindow(this.mainWindow);
    this.ipcBridge.setMainWindow(this.mainWindow);

    // Load the foundation layer (not eveshell!)
    const foundationPath = path.join(
      __dirname,
      "../foundation/foundation.html"
    );
    this.mainWindow.loadFile(foundationPath);

    // Launch autostart apps after foundation loads
    this.mainWindow.webContents.once("did-finish-load", () => {
      this.autostartManager.launchAll();
    });

    // Show window when foundation and overlay are ready
    this.mainWindow.once("ready-to-show", () => {
      this.mainWindow?.show();
    });

    // Handle window close
    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });

    // Development: Open DevTools
    if (this.config.development || process.env.NODE_ENV === "development") {
      this.mainWindow.webContents.openDevTools();
    }
  }

  /**
   * Handle all windows closed
   */
  private onWindowAllClosed(): void {
    app.quit();
  }

  /**
   * Handle app activate (macOS)
   */
  private onActivate(): void {
    // On macOS, recreate window when dock icon is clicked
    if (this.mainWindow === null) {
      this.createMainWindow();
    }
  }

  /**
   * Handle app quit
   */
  private async onBeforeQuit(): Promise<void> {
    console.log("Eden shutting down...");

    try {
      // Shutdown all apps and wait for them to stop
      await this.processManager.shutdown();

      // Brief delay to ensure all cleanup completes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cleanup IPC bridge
      this.ipcBridge.destroy();

      console.log("Eden shutdown complete");
    } catch (error) {
      console.error("Error during shutdown:", error);
    }
  }
}

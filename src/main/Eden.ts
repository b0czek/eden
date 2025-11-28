import "reflect-metadata";
import { app, BrowserWindow } from "electron";
import * as path from "path";
import { IPCBridge, CommandRegistry } from "./ipc";
import { SystemHandler } from "./SystemHandler";
import { EdenConfig } from "../types";

// Managers and Handlers
import { PackageManager, PackageHandler } from "./package-manager";
import {
  ProcessManager,
  ProcessHandler,
  WorkerManager,
} from "./process-manager";
import { ViewManager, ViewHandler } from "./view-manager";
import { FilesystemHandler } from "./filesystem";
import { container } from "tsyringe";

export class Eden {
  private mainWindow: BrowserWindow | null = null;
  private shellOverlayViewId: number | null = null; // Track shell overlay view
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
  private filesystemHandler: FilesystemHandler;

  constructor(config: EdenConfig = {}) {
    this.config = config;

    // Enable overlay scrollbars
    app.commandLine.appendSwitch("enable-features", "OverlayScrollbar");
    app.commandLine.appendSwitch("enable-overlay-scrollbar");

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

    // Initialize Filesystem Handler
    this.filesystemHandler = new FilesystemHandler(this.userDirectory);
    container.registerInstance("FilesystemHandler", this.filesystemHandler);
    this.commandRegistry.registerManager(this.filesystemHandler);

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

    // Create shell overlay as an overlay view after foundation loads
    this.mainWindow.webContents.once("did-finish-load", () => {
      this.createShellOverlay();
    });

    // Show window when foundation and overlay are ready
    this.mainWindow.once("ready-to-show", () => {
      this.mainWindow?.show();
    });

    // Handle window close
    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
      this.shellOverlayViewId = null;
    });

    // Development: Open DevTools
    if (this.config.development || process.env.NODE_ENV === "development") {
      this.mainWindow.webContents.openDevTools();
    }
  }

  /**
   * Create the shell overlay as an overlay view
   */
  private createShellOverlay(): void {
    if (!this.mainWindow) {
      console.error("Cannot create shell overlay: main window not available");
      return;
    }

    // Create a minimal manifest for the shell overlay
    const shellManifest = {
      id: "eden.shell-overlay",
      name: "Shell Overlay",
      version: "1.0.0",
      frontend: {
        entry: "index.html",
      },
      window: {
        mode: "floating" as const,
        injections: {
          css: true,
          appFrame: false, // Shell doesn't need the app frame
        },
      },
    };

    const eveshellPath = path.join(__dirname, "../eveshell");
    const windowBounds = this.mainWindow.getBounds();
    const DOCK_HEIGHT = 72; // Should match CSS variable

    // Initial bounds: dock mode at bottom
    const initialBounds = {
      x: 0,
      y: windowBounds.height - DOCK_HEIGHT,
      width: windowBounds.width,
      height: DOCK_HEIGHT,
    };

    // Create overlay view
    this.shellOverlayViewId = this.viewManager.createOverlayView(
      "eden.shell-overlay",
      shellManifest,
      eveshellPath,
      initialBounds
    );

    console.log(
      `Shell overlay created with viewId: ${this.shellOverlayViewId}`
    );
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

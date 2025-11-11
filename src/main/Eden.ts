import { app, BrowserWindow } from "electron";
import * as path from "path";
import { WorkerManager } from "./core/WorkerManager";
import { ViewManager } from "./core/ViewManager";
import { IPCBridge } from "./core/IPCBridge";
import { AppManager } from "./core/AppManager";
import { TilingConfig } from "../types";

export interface EdenConfig {
  appsDirectory?: string;
  window?: {
    width?: number;
    height?: number;
    title?: string;
    backgroundColor?: string;
  };
  tiling?: TilingConfig;
  development?: boolean;
}

export class Eden {
  private mainWindow: BrowserWindow | null = null;
  private workerManager: WorkerManager;
  private viewManager: ViewManager;
  private ipcBridge: IPCBridge;
  private appManager: AppManager;
  private appsDirectory: string;
  private config: EdenConfig;

  constructor(config: EdenConfig = {}) {
    this.config = config;

    // Set apps directory to user data + /eden-apps or custom path
    this.appsDirectory =
      config.appsDirectory ||
      path.join(app.getPath("userData"), "eden-apps");

    // Initialize core managers
    this.workerManager = new WorkerManager();
    this.viewManager = new ViewManager(config.tiling);
    this.ipcBridge = new IPCBridge(this.workerManager, this.viewManager);
    this.appManager = new AppManager(
      this.workerManager,
      this.viewManager,
      this.ipcBridge,
      this.appsDirectory
    );

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

    // Initialize app manager
    await this.appManager.initialize();

    // Create main window
    this.createMainWindow();

    console.log("Eden ready!");
  }

  /**
   * Create the main Eden window (shell)
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
        preload: path.join(__dirname, "../eveshell/eve-preload.js"),
      },
      backgroundColor: windowConfig.backgroundColor || "#1e1e1e",
      autoHideMenuBar: true,
      show: false, // Don't show until ready
    });

    // Set managers to use this window
    this.viewManager.setMainWindow(this.mainWindow);
    this.ipcBridge.setMainWindow(this.mainWindow);

    // Load the shell UI
    const shellPath = path.join(__dirname, "../eveshell/index.html");
    this.mainWindow.loadFile(shellPath);

    // Show window when ready
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
    // On macOS, keep app running even when windows are closed
    if (process.platform !== "darwin") {
      app.quit();
    }
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
      await this.appManager.shutdown();

      // Brief delay to ensure all cleanup completes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cleanup IPC bridge
      this.ipcBridge.destroy();

      console.log("Eden shutdown complete");
    } catch (error) {
      console.error("Error during shutdown:", error);
    }
  }

  /**
   * Get the main window instance
   */
  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /**
   * Get the app manager instance
   */
  public getAppManager(): AppManager {
    return this.appManager;
  }

  /**
   * Get the worker manager instance
   */
  public getWorkerManager(): WorkerManager {
    return this.workerManager;
  }

  /**
   * Get the view manager instance
   */
  public getViewManager(): ViewManager {
    return this.viewManager;
  }
}

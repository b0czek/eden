import "reflect-metadata";
import { app, BrowserWindow } from "electron";
import * as path from "path";
import { IPCBridge, CommandRegistry } from "./ipc";
import { AppChannelManager } from "./appbus";
import { SystemHandler } from "./SystemHandler";
import { EdenConfig } from "@edenapp/types";

// Managers and Handlers
import { PackageManager } from "./package-manager";
import {
  ProcessManager,
  BackendManager,
  AutostartManager,
} from "./process-manager";
import { ViewManager } from "./view-manager";
import { FilesystemManager } from "./filesystem";
import { FileOpenManager } from "./file-open";
import { NotificationManager } from "./notification";
import { DbManager } from "./db";
import { SettingsManager } from "./settings";
import { container } from "tsyringe";

export class Eden {
  private mainWindow: BrowserWindow | null = null;
  private viewManager: ViewManager;
  private ipcBridge: IPCBridge;
  private appsDirectory: string;
  private userDirectory: string;
  private config: EdenConfig;

  // New components
  private packageManager: PackageManager;
  private processManager: ProcessManager;
  private fileOpenManager: FileOpenManager;
  private autostartManager: AutostartManager;

  constructor(config: EdenConfig = {}) {
    this.config = config;

    app.commandLine.appendSwitch("enable-features", "V8CodeCache");

    // Set apps directory to user data + /eden-apps or custom path
    this.appsDirectory =
      config.appsDirectory || path.join(app.getPath("userData"), "eden-apps");

    // Set user directory to user data + /eden-user or custom path
    this.userDirectory =
      config.userDirectory || path.join(app.getPath("userData"), "eden-user");

    // Set dist path for runtime assets (preloads, css, apps, etc.) - consumer's dist
    const distPath = path.join(process.cwd(), "dist");

    // 1. Fundamental registries and config
    container.registerInstance("EdenConfig", this.config);
    container.registerInstance("appsDirectory", this.appsDirectory);
    container.registerInstance("distPath", distPath);
    container.registerInstance("userDirectory", this.userDirectory);

    container.resolve(CommandRegistry);

    // 2. Main communication bridge
    container.resolve(BackendManager);
    this.ipcBridge = container.resolve(IPCBridge);

    // 3. UI and Application layer
    this.viewManager = container.resolve(ViewManager);

    // 4. Feature managers
    container.resolve(AppChannelManager);
    this.packageManager = container.resolve(PackageManager);
    this.processManager = container.resolve(ProcessManager);
    container.resolve(SystemHandler);
    container.resolve(FilesystemManager);
    this.fileOpenManager = container.resolve(FileOpenManager);
    this.autostartManager = container.resolve(AutostartManager);
    container.resolve(NotificationManager);
    container.resolve(DbManager);

    container.resolve(SettingsManager);

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
    const distPath = path.join(process.cwd(), "dist");

    this.mainWindow = new BrowserWindow({
      width: windowConfig.width || 1280,
      height: windowConfig.height || 800,
      title: windowConfig.title || "Eden",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(distPath, "foundation/foundation-preload.js"),
      },
      backgroundColor: windowConfig.backgroundColor || "#1e1e1e",
      autoHideMenuBar: true,
      show: false, // Don't show until ready
    });

    // Set managers to use this window
    this.viewManager.setMainWindow(this.mainWindow);
    this.ipcBridge.setMainWindow(this.mainWindow);

    // Load the foundation layer (not eveshell!)
    const foundationPath = path.join(distPath, "foundation/foundation.html");
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

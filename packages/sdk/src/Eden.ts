import "reflect-metadata";
import { app, BrowserWindow } from "electron";
import * as fs from "fs";
import * as path from "path";
import { IPCBridge, CommandRegistry } from "./ipc";
import { AppChannelManager } from "./appbus";
import { SystemHandler } from "./SystemHandler";
import { I18nManager } from "./i18n/I18nManager";
import { EdenConfig } from "@edenapp/types";
import { log } from "./logging";
import { attachWebContentsLogger } from "./logging/electron";
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
import { AppearanceManager } from "./appearance/AppearanceManager";
import { UserManager } from "./user";
import { seedDatabase } from "./seed";
import { container } from "tsyringe";

export class Eden {
  private mainWindow: BrowserWindow | null = null;
  private viewManager!: ViewManager;
  private ipcBridge: IPCBridge;
  private appsDirectory: string;
  private userDirectory: string;
  private distPath: string;
  private config: EdenConfig;
  private managersInitialized = false;

  // New components
  private packageManager!: PackageManager;
  private processManager!: ProcessManager;
  private fileOpenManager!: FileOpenManager;
  private autostartManager!: AutostartManager;
  private userManager!: UserManager;

  constructor(config: EdenConfig = {}) {
    this.config = {
      ...config,
      loginAppId: config.loginAppId ?? "com.eden.login",
    };

    app.commandLine.appendSwitch("enable-features", "V8CodeCache");

    // Set apps directory to user data + /eden-apps or custom path
    this.appsDirectory =
      config.appsDirectory || path.join(app.getPath("userData"), "eden-apps");

    // Set user directory to user data + /eden-user or custom path
    this.userDirectory =
      config.userDirectory || path.join(app.getPath("userData"), "eden-user");

    // Set dist path for runtime assets (preloads, css, apps, etc.) - consumer's dist
    this.distPath = path.join(process.cwd(), "dist");

    this.ensureDirectory(this.appsDirectory, "appsDirectory");
    this.ensureDirectory(this.userDirectory, "userDirectory");

    // 1. Fundamental registries and config
    container.registerInstance("EdenConfig", this.config);
    container.registerInstance("appsDirectory", this.appsDirectory);
    container.registerInstance("distPath", this.distPath);
    container.registerInstance("userDirectory", this.userDirectory);

    container.resolve(CommandRegistry);

    // 2. Main communication bridge
    container.resolve(BackendManager);
    this.ipcBridge = container.resolve(IPCBridge);

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
    log.info("Eden starting...");

    // Seed database before initializing managers
    await seedDatabase(this.appsDirectory, this.distPath);

    this.initializeManagers();

    await this.userManager.initialize();

    // Initialize package manager
    await this.packageManager.initialize();

    // Initialize Appearance Manager (load saved wallpaper)
    await container.resolve(AppearanceManager).initialize();

    // Initialize file open manager (load user preferences)
    await this.fileOpenManager.initialize();

    // Create main window
    this.createMainWindow();

    log.info("Eden ready!");
  }

  private initializeManagers(): void {
    if (this.managersInitialized) return;
    this.managersInitialized = true;

    // UI and core services
    this.viewManager = container.resolve(ViewManager);
    container.resolve(AppChannelManager);
    container.resolve(FilesystemManager);

    // Auth + settings should be available before other managers.
    this.userManager = container.resolve(UserManager);
    container.resolve(SettingsManager);
    container.resolve(I18nManager);

    this.packageManager = container.resolve(PackageManager);
    this.processManager = container.resolve(ProcessManager);
    this.fileOpenManager = container.resolve(FileOpenManager);
    this.autostartManager = container.resolve(AutostartManager);

    container.resolve(SystemHandler);
    container.resolve(NotificationManager);
    container.resolve(DbManager);
    container.resolve(AppearanceManager);
  }

  private ensureDirectory(directory: string, label: string): void {
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (error) {
      log.error(`Failed to create ${label} at ${directory}:`, error);
      throw error;
    }
  }

  /**
   * Create the main Eden window with foundation layer
   */
  private createMainWindow(): void {
    const windowConfig = this.config.window || {};
    this.mainWindow = new BrowserWindow({
      width: windowConfig.width || 1280,
      height: windowConfig.height || 800,
      minWidth: 800,
      minHeight: 600,
      title: windowConfig.title || "Eden",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(this.distPath, "foundation/foundation-preload.js"),
        additionalArguments: [`--window-title=${windowConfig.title || "Eden"}`],
      },
      backgroundColor: windowConfig.backgroundColor || "#1e1e1e",
      autoHideMenuBar: true,
      show: false, // Don't show until ready
    });

    attachWebContentsLogger(this.mainWindow.webContents, {
      source: "foundation",
    });

    // Set managers to use this window
    this.viewManager.setMainWindow(this.mainWindow);
    this.ipcBridge.setMainWindow(this.mainWindow);

    // Load the foundation layer (not eveshell!)
    const foundationPath = path.join(
      this.distPath,
      "foundation/foundation.html",
    );
    this.mainWindow.loadFile(foundationPath);

    // Launch autostart apps after foundation loads
    this.mainWindow.webContents.once("did-finish-load", () => {
      this.autostartManager.onFoundationReady();
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
    log.info("Eden shutting down...");

    try {
      if (!this.managersInitialized) {
        return;
      }
      // Shutdown all apps and wait for them to stop
      await this.processManager.shutdown();

      // Brief delay to ensure all cleanup completes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cleanup IPC bridge
      this.ipcBridge.destroy();

      log.info("Eden shutdown complete");
    } catch (error) {
      log.error("Error during shutdown:", error);
    }
  }
}

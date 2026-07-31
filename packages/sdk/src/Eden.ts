import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import { app, BrowserWindow } from "electron";
import { container } from "tsyringe";
import type {
  EdenAppearanceApi,
  EdenAppsApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenLifecycleState,
  EdenSessionsApi,
  EdenSettingsApi,
  EdenUsersApi,
} from "./api";
import {
  createControlPlaneApis,
  type EdenControlPlaneApis,
} from "./api/createControlPlaneApi";
import { createSettingsApi } from "./api/createSettingsApi";
import { AppAssociationManager } from "./app-associations";
import { AppCatalog } from "./app-registry";
import { AppChannelManager } from "./appbus";
import { AppearanceManager } from "./appearance/AppearanceManager";
import { BrandingManager } from "./branding";
import { ContextMenuManager } from "./context-menu";
import { DaemonManager } from "./daemon";
import { DbManager } from "./db";
import { ExecutionContext } from "./execution/ExecutionContext";
import { FileOpenManager } from "./file-open";
import { FilePickerManager } from "./file-picker";
import { FilesystemManager } from "./filesystem";
import { I18nManager } from "./i18n/I18nManager";
import { CommandRegistry, IPCBridge } from "./ipc";
import { KeyboardManager } from "./keyboard/KeyboardManager";
import { log } from "./logging";
import { attachWebContentsLogger } from "./logging/electron";
import { NotificationManager } from "./notification";
// Managers and Handlers
import { PackageManager } from "./package-manager";
import {
  AutostartManager,
  BackendManager,
  ProcessManager,
} from "./process-manager";
import { SystemHandler } from "./SystemHandler";
import { seedDatabase } from "./seed";
import { SessionManager } from "./session";
import {
  registerBuiltinSettingsPanels,
  SettingsManager,
  SettingsPanelManager,
} from "./settings";
import { GrantCatalogManager, UserManager } from "./user";
import { UserHandler } from "./user/UserHandler";
import { ViewManager } from "./view-manager";

export class Eden {
  private mainWindow: BrowserWindow | null = null;
  private viewManager!: ViewManager;
  private ipcBridge: IPCBridge;
  private appsDirectory: string;
  private userDirectory: string;
  private distPath: string;
  private config: EdenConfig;
  private brandingManager: BrandingManager;
  private managersInitialized = false;
  private lifecycleState: EdenLifecycleState = "created";
  private controlPlaneApis?: EdenControlPlaneApis;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;

  // New components
  private packageManager!: PackageManager;
  private processManager!: ProcessManager;
  private fileOpenManager!: FileOpenManager;
  private appAssociationManager!: AppAssociationManager;
  private autostartManager!: AutostartManager;
  private userManager!: UserManager;
  private sessionManager!: SessionManager;
  private daemonManager!: DaemonManager;
  private keyboardManager!: KeyboardManager;
  private settingsPanelManager: SettingsPanelManager;
  public readonly settings: EdenSettingsApi;

  constructor(config: EdenConfig = {}) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
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
    container.registerInstance("appPath", app.getAppPath());

    this.brandingManager = container.resolve(BrandingManager);

    container.resolve(CommandRegistry);

    // 2. Main communication bridge
    container.resolve(BackendManager);
    this.ipcBridge = container.resolve(IPCBridge);
    this.settingsPanelManager = container.resolve(SettingsPanelManager);
    this.settings = createSettingsApi(this.settingsPanelManager);

    this.setupAppEventHandlers();
  }

  /** Wait until Eden and all operational managers are initialized. */
  public whenReady(): Promise<void> {
    return this.readyPromise;
  }

  public get state(): EdenLifecycleState {
    return this.lifecycleState;
  }

  public get apps(): EdenAppsApi {
    return this.requireControlPlaneApis().apps;
  }

  public get daemons(): EdenDaemonsApi {
    return this.requireControlPlaneApis().daemons;
  }

  public get users(): EdenUsersApi {
    return this.requireControlPlaneApis().users;
  }

  public get sessions(): EdenSessionsApi {
    return this.requireControlPlaneApis().sessions;
  }

  public get appearance(): EdenAppearanceApi {
    return this.requireControlPlaneApis().appearance;
  }

  public get associations(): EdenAssociationsApi {
    return this.requireControlPlaneApis().associations;
  }

  private requireControlPlaneApis(): EdenControlPlaneApis {
    if (!this.controlPlaneApis || this.lifecycleState !== "ready") {
      throw new Error(
        "Eden is not ready. Await eden.whenReady() before using operational APIs.",
      );
    }
    return this.controlPlaneApis;
  }

  /**
   * Setup Electron app event handlers
   */
  private setupAppEventHandlers(): void {
    void app.whenReady().then(() => this.start());
    app.on("window-all-closed", () => this.onWindowAllClosed());
    app.on("activate", () => this.onActivate());
    app.on("before-quit", () => this.onBeforeQuit());
  }

  private async start(): Promise<void> {
    if (this.lifecycleState !== "created") return;
    this.lifecycleState = "starting";
    try {
      await this.onReady();
      this.lifecycleState = "ready";
      this.resolveReady();
    } catch (error) {
      this.lifecycleState = "failed";
      this.rejectReady(error);
      log.error("Eden failed to start", error);
    }
  }

  /**
   * Handle app ready event
   */
  private async onReady(): Promise<void> {
    log.info("Eden starting...");

    // Seed database before initializing managers
    await seedDatabase(
      this.appsDirectory,
      this.config.seedPath ?? path.join(this.distPath, "eden-seed.json"),
      this.userDirectory,
    );

    this.initializeManagers();

    await this.userManager.initialize();
    // Initialize package manager
    await this.packageManager.initialize();
    this.settingsPanelManager.synchronizeManifestPanels();

    // System-owned daemons start before any interactive session is committed.
    await this.daemonManager.initialize();
    await this.sessionManager.initialize();

    // Initialize Appearance Manager (load saved wallpaper)
    await container.resolve(AppearanceManager).initialize();

    // Initialize file open manager (load user preferences)
    await this.appAssociationManager.initialize();
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
    this.sessionManager = container.resolve(SessionManager);
    this.daemonManager = container.resolve(DaemonManager);
    container
      .resolve(CommandRegistry)
      .registerManager(
        new UserHandler(
          this.userManager,
          this.sessionManager,
          container.resolve(ExecutionContext),
          container.resolve(GrantCatalogManager),
        ),
      );
    this.appAssociationManager = container.resolve(AppAssociationManager);
    this.fileOpenManager = container.resolve(FileOpenManager);
    this.autostartManager = container.resolve(AutostartManager);
    this.keyboardManager = container.resolve(KeyboardManager);

    container.resolve(SystemHandler);
    container.resolve(NotificationManager);
    container.resolve(ContextMenuManager);
    container.resolve(FilePickerManager);
    container.resolve(DbManager);
    const appearanceManager = container.resolve(AppearanceManager);
    this.controlPlaneApis = createControlPlaneApis({
      appCatalog: container.resolve(AppCatalog),
      packageManager: this.packageManager,
      daemonManager: this.daemonManager,
      userManager: this.userManager,
      sessionManager: this.sessionManager,
      appearanceManager,
      associationManager: this.appAssociationManager,
      executionContext: container.resolve(ExecutionContext),
    });
    registerBuiltinSettingsPanels({
      panels: this.settingsPanelManager,
      settings: container.resolve(SettingsManager),
      appCatalog: container.resolve(AppCatalog),
      appearanceManager,
      packageManager: this.packageManager,
      daemonManager: this.daemonManager,
      userManager: this.userManager,
      config: this.config,
    });
    this.settingsPanelManager.connectLifecycle(
      this.sessionManager,
      this.packageManager,
      this.daemonManager,
    );
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
    const title = this.brandingManager.getWindowTitle(windowConfig.title);
    const icon = this.brandingManager.getWindowIconPath();

    this.mainWindow = new BrowserWindow({
      width: windowConfig.width || 1280,
      height: windowConfig.height || 800,
      minWidth: Math.max(windowConfig.minWidth || 800, 800),
      minHeight: Math.max(windowConfig.minHeight || 600, 600),
      title,
      icon,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: path.join(this.distPath, "foundation/foundation-preload.js"),
        additionalArguments: [`--window-title=${title}`],
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
    this.keyboardManager.setMainWindow(this.mainWindow);

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
    this.lifecycleState = "stopping";
    log.info("Eden shutting down...");

    try {
      if (!this.managersInitialized) {
        return;
      }
      // Shutdown all apps and wait for them to stop
      await this.daemonManager.shutdown();
      await this.processManager.shutdown();

      // Brief delay to ensure all cleanup completes
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Cleanup IPC bridge
      this.keyboardManager.destroy();
      this.ipcBridge.destroy();

      log.info("Eden shutdown complete");
    } catch (error) {
      log.error("Error during shutdown:", error);
    } finally {
      this.lifecycleState = "stopped";
    }
  }
}

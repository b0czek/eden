import "reflect-metadata";
import * as fs from "node:fs";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import {
  type DependencyContainer,
  type InjectionToken,
  container as rootContainer,
} from "tsyringe";
import type {
  EdenAppearanceApi,
  EdenAppsApi,
  EdenAssociationsApi,
  EdenDaemonsApi,
  EdenLifecycleState,
  EdenSessionsApi,
  EdenSettingsApi,
  EdenUsersApi,
} from "../api";
import {
  createControlPlaneApis,
  type EdenControlPlaneApis,
} from "../api/createControlPlaneApi";
import { createSettingsApi } from "../api/createSettingsApi";
import { AppAssociationManager } from "../app-associations";
import { AppCatalog } from "../app-registry";
import { AppChannelManager } from "../appbus";
import { AppearanceManager } from "../appearance/AppearanceManager";
import { BrandingManager } from "../branding";
import { ContextMenuManager } from "../context-menu";
import { DaemonManager } from "../daemon";
import { DbManager } from "../db";
import { ExecutionContext } from "../execution/ExecutionContext";
import { FileOpenManager } from "../file-open";
import { FilePickerManager } from "../file-picker";
import { FilesystemManager } from "../filesystem";
import { I18nManager } from "../i18n/I18nManager";
import { CommandRegistry, IPCBridge, PermissionRegistry } from "../ipc";
import { KeyboardManager } from "../keyboard/KeyboardManager";
import { log } from "../logging";
import { NotificationManager } from "../notification";
import { PackageManager } from "../package-manager";
import {
  type EdenPlatform,
  PLATFORM_APP_CHANNELS,
  PLATFORM_DISPLAY,
  PLATFORM_PROCESS_METRICS,
  PLATFORM_RENDERER_IPC,
  PLATFORM_SHORTCUTS,
  PLATFORM_THEME,
  PLATFORM_UTILITY_PROCESSES,
  PLATFORM_WINDOWS,
  type PlatformWindow,
} from "../platform/ports";
import { PowerHandler } from "../power";
import {
  AutostartManager,
  BackendManager,
  ProcessManager,
} from "../process-manager";
import { SystemHandler } from "../SystemHandler";
import { seedDatabase } from "../seed";
import { SessionManager } from "../session";
import {
  registerBuiltinSettingsPanels,
  SettingsManager,
  SettingsPanelManager,
} from "../settings";
import { GrantCatalogManager, UserManager } from "../user";
import { UserHandler } from "../user/UserHandler";
import { ViewManager } from "../view-manager";

export interface EdenRuntimePaths {
  appsDirectory: string;
  userDirectory: string;
  distPath: string;
  appPath: string;
}

export interface EdenRuntimeOptions {
  config?: EdenConfig;
  paths: EdenRuntimePaths;
  platform: EdenPlatform;
  parentContainer?: DependencyContainer;
}

/**
 * Internal composition root for one Eden instance.
 *
 * Every mutable service is resolved from this runtime's child container. The
 * Electron-specific presentation code remains here only until the platform
 * adapter migration; consumers continue to interact with the public Eden host.
 */
export class EdenRuntime {
  private readonly container: DependencyContainer;
  private readonly ownedServices: Array<{
    dispose: () => void | Promise<void>;
  }> = [];
  private readonly ownedServiceSet = new Set<object>();
  private readonly config: EdenConfig;
  private readonly paths: EdenRuntimePaths;
  private mainWindow: PlatformWindow | null = null;
  private readonly platform: EdenPlatform;
  private viewManager!: ViewManager;
  private readonly ipcBridge: IPCBridge;
  private readonly brandingManager: BrandingManager;
  private readonly settingsPanelManager: SettingsPanelManager;
  private managersInitialized = false;
  private resourcesDisposed = false;
  private lifecycleState: EdenLifecycleState = "created";
  private controlPlaneApis?: EdenControlPlaneApis;
  private startPromise?: Promise<void>;
  private disposePromise?: Promise<void>;
  private readonly readyPromise: Promise<void>;
  private resolveReady!: () => void;
  private rejectReady!: (error: unknown) => void;
  private readySettled = false;

  private packageManager!: PackageManager;
  private processManager!: ProcessManager;
  private fileOpenManager!: FileOpenManager;
  private appAssociationManager!: AppAssociationManager;
  private autostartManager!: AutostartManager;
  private userManager!: UserManager;
  private sessionManager!: SessionManager;
  private daemonManager!: DaemonManager;
  private keyboardManager!: KeyboardManager;

  public readonly settings: EdenSettingsApi;

  constructor(options: EdenRuntimeOptions) {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    // A host may choose not to await readiness. Keep the owned rejection from
    // becoming an unhandled rejection while preserving the returned promise.
    void this.readyPromise.catch(() => undefined);

    this.config = {
      ...options.config,
      loginAppId: options.config?.loginAppId ?? "com.eden.login",
    };
    this.paths = { ...options.paths };
    this.platform = options.platform;
    this.ensureDirectory(this.paths.appsDirectory, "appsDirectory");
    this.ensureDirectory(this.paths.userDirectory, "userDirectory");

    this.container = (
      options.parentContainer ?? rootContainer
    ).createChildContainer();
    this.container.registerInstance("EdenConfig", this.config);
    this.container.registerInstance("appsDirectory", this.paths.appsDirectory);
    this.container.registerInstance("distPath", this.paths.distPath);
    this.container.registerInstance("userDirectory", this.paths.userDirectory);
    this.container.registerInstance("appPath", this.paths.appPath);
    this.container.registerInstance(PLATFORM_WINDOWS, this.platform.windows);
    this.container.registerInstance(
      PLATFORM_RENDERER_IPC,
      this.platform.rendererIpc,
    );
    this.container.registerInstance(
      PLATFORM_UTILITY_PROCESSES,
      this.platform.utilityProcesses,
    );
    this.container.registerInstance(
      PLATFORM_APP_CHANNELS,
      this.platform.appChannels,
    );
    this.container.registerInstance(PLATFORM_DISPLAY, this.platform.display);
    this.container.registerInstance(
      PLATFORM_PROCESS_METRICS,
      this.platform.processMetrics,
    );
    this.container.registerInstance(
      PLATFORM_SHORTCUTS,
      this.platform.shortcuts,
    );
    this.container.registerInstance(PLATFORM_THEME, this.platform.theme);

    this.brandingManager = this.resolveOwned(BrandingManager);
    this.resolveOwned(CommandRegistry);
    this.resolveOwned(BackendManager);
    this.ipcBridge = this.resolveOwned(IPCBridge);
    this.settingsPanelManager = this.resolveOwned(SettingsPanelManager);
    this.settings = createSettingsApi(this.settingsPanelManager);

    const permissions = this.resolveOwned(PermissionRegistry);
    permissions.registerEventPermission(
      "settings/panels-changed",
      "settings/panels",
    );
    permissions.registerEventPermission(
      "user/grant-options-changed",
      "user/manage",
    );
  }

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

  /** Resolve an internal runtime-owned service for SDK infrastructure. */
  public resolve<T>(token: InjectionToken<T>): T {
    return this.resolveOwned(token);
  }

  private resolveOwned<T>(token: InjectionToken<T>): T {
    const instance = this.container.resolve(token);
    if (
      instance &&
      typeof instance === "object" &&
      "dispose" in instance &&
      typeof instance.dispose === "function" &&
      !this.ownedServiceSet.has(instance)
    ) {
      this.ownedServiceSet.add(instance);
      this.ownedServices.push(
        instance as { dispose: () => void | Promise<void> },
      );
    }
    return instance;
  }

  public start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    if (this.lifecycleState === "ready") return Promise.resolve();
    if (this.lifecycleState !== "created") {
      return Promise.reject(
        new Error(
          `Cannot start Eden runtime from ${this.lifecycleState} state`,
        ),
      );
    }

    this.lifecycleState = "starting";
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  public dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposePromise = this.disposeInternal();
    return this.disposePromise;
  }

  /** Recreate the foundation window when the host application is activated. */
  public activate(): void {
    if (this.lifecycleState === "ready" && this.mainWindow === null) {
      this.createMainWindow();
    }
  }

  private async startInternal(): Promise<void> {
    try {
      log.info("Eden starting...");
      await seedDatabase(
        this.paths.appsDirectory,
        this.config.seedPath ??
          path.join(this.paths.distPath, "eden-seed.json"),
        this.paths.userDirectory,
      );

      this.initializeManagers();
      await this.userManager.initialize();
      await this.packageManager.initialize();
      this.settingsPanelManager.synchronizeManifestPanels();
      await this.daemonManager.initialize();
      await this.sessionManager.initialize();
      await this.resolveOwned(AppearanceManager).initialize();
      await this.appAssociationManager.initialize();
      await this.fileOpenManager.initialize();
      this.createMainWindow();

      this.lifecycleState = "ready";
      this.readySettled = true;
      this.resolveReady();
      log.info("Eden ready!");
    } catch (error) {
      await this.disposeResources();
      this.lifecycleState = "failed";
      this.readySettled = true;
      this.rejectReady(error);
      log.error("Eden failed to start", error);
      throw error;
    }
  }

  private initializeManagers(): void {
    if (this.managersInitialized) return;
    this.managersInitialized = true;

    this.viewManager = this.resolveOwned(ViewManager);
    this.resolveOwned(AppChannelManager);
    this.resolveOwned(FilesystemManager);
    this.userManager = this.resolveOwned(UserManager);
    this.resolveOwned(SettingsManager);
    this.resolveOwned(I18nManager);
    this.packageManager = this.resolveOwned(PackageManager);
    this.processManager = this.resolveOwned(ProcessManager);
    this.sessionManager = this.resolveOwned(SessionManager);
    this.daemonManager = this.resolveOwned(DaemonManager);
    this.resolveOwned(CommandRegistry).registerManager(
      new UserHandler(
        this.userManager,
        this.sessionManager,
        this.resolveOwned(ExecutionContext),
        this.resolveOwned(GrantCatalogManager),
      ),
    );
    this.appAssociationManager = this.resolveOwned(AppAssociationManager);
    this.fileOpenManager = this.resolveOwned(FileOpenManager);
    this.autostartManager = this.resolveOwned(AutostartManager);
    this.keyboardManager = this.resolveOwned(KeyboardManager);

    this.resolveOwned(SystemHandler);
    this.resolveOwned(PowerHandler);
    this.resolveOwned(NotificationManager);
    this.resolveOwned(ContextMenuManager);
    this.resolveOwned(FilePickerManager);
    this.resolveOwned(DbManager);
    const appearanceManager = this.resolveOwned(AppearanceManager);
    this.controlPlaneApis = createControlPlaneApis({
      appCatalog: this.resolveOwned(AppCatalog),
      packageManager: this.packageManager,
      daemonManager: this.daemonManager,
      userManager: this.userManager,
      sessionManager: this.sessionManager,
      appearanceManager,
      associationManager: this.appAssociationManager,
      executionContext: this.resolveOwned(ExecutionContext),
    });
    registerBuiltinSettingsPanels({
      panels: this.settingsPanelManager,
      settings: this.resolveOwned(SettingsManager),
      appCatalog: this.resolveOwned(AppCatalog),
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

  private requireControlPlaneApis(): EdenControlPlaneApis {
    if (!this.controlPlaneApis || this.lifecycleState !== "ready") {
      throw new Error(
        "Eden is not ready. Await eden.whenReady() before using operational APIs.",
      );
    }
    return this.controlPlaneApis;
  }

  private ensureDirectory(directory: string, label: string): void {
    try {
      fs.mkdirSync(directory, { recursive: true });
    } catch (error) {
      log.error(`Failed to create ${label} at ${directory}:`, error);
      throw error;
    }
  }

  private createMainWindow(): void {
    const windowConfig = this.config.window || {};
    const title = this.brandingManager.getWindowTitle(windowConfig.title);
    const icon = this.brandingManager.getWindowIconPath();

    this.mainWindow = this.platform.windows.createWindow({
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
        preload: path.join(
          this.paths.distPath,
          "foundation/foundation-preload.js",
        ),
        additionalArguments: [`--window-title=${title}`],
      },
      backgroundColor: windowConfig.backgroundColor || "#1e1e1e",
      autoHideMenuBar: true,
      show: false,
    });

    this.platform.windows.attachWebContentsLogger(this.mainWindow.webContents, {
      source: "foundation",
    });
    this.viewManager.setMainWindow(this.mainWindow);
    this.ipcBridge.setMainWindow(this.mainWindow);
    this.keyboardManager.setMainWindow(this.mainWindow);
    this.mainWindow.loadFile(
      path.join(this.paths.distPath, "foundation/foundation.html"),
    );
    this.mainWindow.webContents.once("did-finish-load", () => {
      this.autostartManager.onFoundationReady();
    });
    this.mainWindow.once("ready-to-show", () => {
      this.mainWindow?.show();
    });
    this.mainWindow.on("closed", () => {
      this.mainWindow = null;
    });
  }

  private async disposeInternal(): Promise<void> {
    if (this.lifecycleState === "stopped") return;
    const disposedBeforeStart = this.lifecycleState === "created";
    this.lifecycleState = "stopping";
    if (disposedBeforeStart && !this.readySettled) {
      this.readySettled = true;
      this.rejectReady(new Error("Eden runtime disposed before startup"));
    }
    log.info("Eden shutting down...");

    try {
      if (this.startPromise) {
        await this.startPromise.catch(() => undefined);
      }
      await this.disposeResources();
      log.info("Eden shutdown complete");
    } catch (error) {
      log.error("Error during shutdown:", error);
    } finally {
      this.lifecycleState = "stopped";
    }
  }

  private async disposeResources(): Promise<void> {
    if (this.resourcesDisposed) return;
    this.resourcesDisposed = true;

    if (this.managersInitialized) {
      await this.daemonManager.shutdown();
      await this.processManager.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
      this.mainWindow = null;
    }
    for (let index = this.ownedServices.length - 1; index >= 0; index--) {
      try {
        await this.ownedServices[index].dispose();
      } catch (error) {
        log.error("Error disposing Eden runtime resource:", error);
      }
    }
    this.ownedServices.length = 0;
    this.ownedServiceSet.clear();

    try {
      await this.container.dispose();
    } catch (error) {
      // Services are deliberately disposed above in reverse ownership order.
      // The container pass releases any indirectly-created disposables.
      log.error("Error disposing Eden runtime container:", error);
    }
  }
}

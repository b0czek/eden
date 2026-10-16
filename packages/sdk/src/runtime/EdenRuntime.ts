import * as fs from "node:fs";
import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { EdenLifecycleState } from "../api";
import {
  createControlPlaneApis,
  type EdenControlPlaneApis,
} from "../api/createControlPlaneApi";
import { createSdkContext } from "../api/sdk-context";
import {
  type AppAssociations,
  createAppAssociations,
  createAppAssociationsController,
  createJsonFileAssociationStorage,
} from "../app-associations";
import {
  type AppChannels,
  createAppChannels,
  createAppChannelsController,
} from "../appbus";
import { createAppearanceController } from "../appearance/controller-edenapi";
import { type Appearance, createAppearance } from "../appearance/service";
import { createAppearanceSettings } from "../appearance/settings-adapter";
import {
  type Autostart,
  createAutostart,
  createAutostartProcesses,
  createDevelopmentAutostart,
} from "../autostart";
import {
  type Branding,
  createBranding,
  createBrandingController,
  createFilesystemBrandingAssets,
  resolveBrandingName,
} from "../branding";
import {
  createContextMenu,
  createContextMenuController,
  createContextMenuViews,
} from "../context-menu";
import type { Controller } from "../controllers/controller";
import { createDaemonController } from "../daemon/controller-edenapi";
import {
  createDaemonManager,
  type DaemonManager,
} from "../daemon/DaemonManager";
import { connectDaemonLifecycle } from "../daemon/lifecycle";
import { createDb, createDbController, createSqliteDbStorage } from "../db";
import { createEffectRuntime } from "../effects/runtime";
import { listen } from "../events/scoped";
import {
  createExecutionContext,
  type ExecutionContext,
} from "../execution/ExecutionContext";
import {
  createRuntimeContextRegistry,
  type RuntimeContextRegistry,
} from "../execution/RuntimeContextRegistry";
import {
  createFileOpen,
  createFileOpenController,
  createFileOpenFilesystem,
  createFileOpenOperations,
  createFileOpenProcesses,
} from "../file-open";
import {
  createFilePicker,
  createFilePickerController,
  createFilePickerFiles,
  createFilePickerNotifications,
  createFilePickerProcesses,
  createFilePickerViews,
} from "../file-picker";
import { createVolumeController } from "../filesystem/controller-edenapi";
import { createFilesystemController } from "../filesystem/controller-edenapi-files";
import {
  createFilesystemManager,
  type FilesystemManager,
} from "../filesystem/FilesystemManager";
import {
  createVolumeManager,
  type VolumeManager,
} from "../filesystem/VolumeManager";
import { createI18nController } from "../i18n/controller-edenapi";
import { createI18n } from "../i18n/service";
import { createI18nSettings } from "../i18n/settings";
import {
  type CommandRegistry,
  createCommandRegistry,
} from "../ipc/CommandRegistry";
import { createIPCBridge, type IPCBridge } from "../ipc/IPCBridge";
import {
  createPermissionRegistry,
  type PermissionRegistry,
} from "../ipc/PermissionRegistry";
import {
  createKeyboard,
  createKeyboardAssets,
  createKeyboardViews,
  type Keyboard,
} from "../keyboard";
import { log } from "../logging";
import {
  createNotificationController,
  createNotifications,
  createNotificationViews,
} from "../notification";
import { createOperationController } from "../operations/controller-edenapi";
import { createOperationsSdkController } from "../operations/controller-sdk";
import {
  createOperationManager,
  type OperationManager,
} from "../operations/OperationManager";
import { createPackageController } from "../package-manager/controller-edenapi";
import {
  createDlcResourceManager,
  type DlcResourceManager,
} from "../package-manager/DlcResourceManager";
import {
  createPackageCatalog,
  type PackageCatalog,
} from "../package-manager/PackageCatalog";
import {
  createPackageManager,
  type PackageManager,
} from "../package-manager/PackageManager";
import {
  createPackageOperationCoordinator,
  type PackageOperationCoordinator,
} from "../package-manager/PackageOperationCoordinator";
import {
  createPackageRegistry,
  type PackageRegistry,
} from "../package-manager/PackageRegistry";
import { createDlcResourceProtocols } from "../package-manager/resource-adapter";
import type { EdenPlatform, PlatformWindow } from "../platform/ports";
import { createPower, createPowerController, createPowerHost } from "../power";
import {
  type BackendManager,
  createBackendManager,
} from "../process-manager/BackendManager";
import { createProcessController } from "../process-manager/controller-edenapi";
import {
  createProcessManager,
  type ProcessManager,
} from "../process-manager/ProcessManager";
import { seedDatabase } from "../seed";
import { createSessionController } from "../session/controller-edenapi";
import {
  createSessionContext,
  type SessionContext,
} from "../session/SessionContext";
import {
  createSessionManager,
  type SessionManager,
} from "../session/SessionManager";
import { createSettingsController } from "../settings/controller-edenapi";
import { createSettingsPanelsController } from "../settings/controller-edenapi-panels";
import { createSettingsSdkController } from "../settings/controller-sdk";
import { connectSettingsLifecycle } from "../settings/lifecycle";
import { registerBuiltinSettingsPanels } from "../settings/panels";
import {
  createSettingsPanelManager,
  type SettingsPanelManager,
} from "../settings/SettingsPanelManager";
import { createSettings, type Settings } from "../settings/service";
import { createSqliteSettingsStorage } from "../settings/sqlite-storage";
import { createSystemController } from "../system/controller-edenapi";
import { createUserController } from "../user/controller-edenapi";
import {
  createGrantCatalogManager,
  type GrantCatalogManager,
} from "../user/GrantCatalogManager";
import { createUserManager, type UserManager } from "../user/UserManager";
import { createUserStore } from "../user/UserStore";
import { normalizeAppIds } from "../utils/normalize";
import { createViewController } from "../view-manager/controller-edenapi";
import { createViewInteractions } from "../view-manager/interactions";
import {
  createViewManager,
  type ViewManager,
} from "../view-manager/ViewManager";

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
}
export interface RuntimeServices {
  execution: ExecutionContext;
  runtimeContexts: RuntimeContextRegistry;
  sessionContext: SessionContext;
  permissions: PermissionRegistry;
  operations: OperationManager;
  commands: CommandRegistry;
  ipc: IPCBridge;
  packageRegistry: PackageRegistry;
  catalog: PackageCatalog;
  packageOperations: PackageOperationCoordinator;
  dlcResources: DlcResourceManager;
  settings: Settings;
  settingsPanels: SettingsPanelManager;
  grants: GrantCatalogManager;
  views: ViewManager;
  backends: BackendManager;
  filesystem: FilesystemManager;
  volumes: VolumeManager;
  packages: PackageManager;
  processes: ProcessManager;
  users: UserManager;
  sessions: SessionManager;
  daemons: DaemonManager;
}

/** Explicit composition and lifecycle ownership for one isolated Eden instance. */
export function createEdenRuntime(options: EdenRuntimeOptions) {
  const config: EdenConfig = {
    ...options.config,
    loginAppId: options.config?.loginAppId ?? "com.eden.login",
  };
  const paths = { ...options.paths };
  const platform = options.platform;
  const effects = createEffectRuntime();
  fs.mkdirSync(paths.appsDirectory, { recursive: true });
  fs.mkdirSync(paths.userDirectory, { recursive: true });
  resolveBrandingName(config.branding);
  const execution = createExecutionContext({ config });
  const sessionContext = createSessionContext();
  const runtimeContexts = createRuntimeContextRegistry({ sessionContext });
  const permissions = createPermissionRegistry();
  const packageRegistry = createPackageRegistry();
  const catalog = createPackageCatalog({
    registry: packageRegistry,
    executionContext: execution,
    appsDirectory: paths.appsDirectory,
    distPath: paths.distPath,
  });
  const packageOperations = createPackageOperationCoordinator({
    appsDirectory: paths.appsDirectory,
  });
  const services = {
    execution,
    sessionContext,
    runtimeContexts,
    permissions,
    packageRegistry,
    catalog,
    packageOperations,
  } as RuntimeServices;
  const operations = createOperationManager({
    effects,
    execution,
    session: sessionContext,
    filesystem: {
      releaseHandles: (sessionId) =>
        services.filesystem?.releaseHandles(sessionId) ?? Effect.void,
    },
  });
  const commands = createCommandRegistry({
    permissionRegistry: permissions,
    sessionContext,
    executionContext: execution,
    operations,
    effects,
  });
  const sdk = createSdkContext({ execution, effects, operations });
  const operationsApi = createOperationsSdkController({ operations, sdk });
  const settingsPanels = createSettingsPanelManager({
    settingsManager: {
      get: (...args) => Effect.suspend(() => services.settings.get(...args)),
      set: (...args) => Effect.suspend(() => services.settings.set(...args)),
    },
    packageCatalog: catalog,
    sessionContext,
    executionContext: execution,
  });
  const settings = createSettingsSdkController({ panels: settingsPanels, sdk });
  const grants = createGrantCatalogManager({
    packageCatalog: catalog,
    settingsPanels,
  });
  Object.assign(services, { operations, commands, settingsPanels, grants });
  const eventPermissions = {
    "settings/panels-changed": "settings/panels",
    "user/grant-options-changed": "user/manage",
    "fs/changed": "fs/read",
    "volume/changed": "volume/read",
  };
  for (const [event, permission] of Object.entries(eventPermissions))
    permissions.registerEventPermission(event, permission);
  let state: EdenLifecycleState = "created";
  let controlPlane: EdenControlPlaneApis | undefined;
  let mainWindow: PlatformWindow | null = null;
  let branding: Branding;
  let appearance: Appearance;
  let associations: AppAssociations;
  let keyboard: Keyboard;
  let autostart: Autostart;
  let channels: AppChannels;
  let startPromise: Promise<void> | undefined;
  let disposePromise: Promise<void> | undefined;
  let resourcesDisposed = false;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  void readyPromise.catch(() => undefined);
  const register = (controller: Controller) =>
    services.ipc.registerController(controller);
  function operational() {
    if (!controlPlane || state !== "ready")
      throw new Error(
        "Eden is not ready. Await eden.whenReady() before using operational APIs.",
      );
    return controlPlane;
  }
  async function initializeServices() {
    branding = await effects.acquire(
      createBranding({
        branding: config.branding,
        assets: createFilesystemBrandingAssets(paths.appPath),
      }),
    );
    services.settings = await effects.acquire(
      createSettings({
        storage: createSqliteSettingsStorage({
          appsDirectory: paths.appsDirectory,
        }),
        catalog: { getAppSettings: (appId) => catalog.getApp(appId)?.settings },
        authorization: execution,
      }),
    );
    services.views = await effects.acquire(
      createViewManager({
        config,
        distPath: paths.distPath,
        settings: services.settings,
        windows: platform.windows,
      }),
    );
    await effects.run(services.views.initialize());
    services.volumes = await effects.acquire(createVolumeManager());
    services.filesystem = await effects.acquire(
      createFilesystemManager({
        baseDir: paths.userDirectory,
        executionContext: execution,
        volumes: services.volumes,
        views: {
          resolveViewId: services.views.getViewIdByWebContentsId,
          removed: services.views.viewRemoved,
        },
      }),
    );
    services.dlcResources = await effects.acquire(
      createDlcResourceManager({
        catalog,
        views: services.views,
        protocols: createDlcResourceProtocols(platform.resources, effects.run),
      }),
    );
    services.backends = await effects.acquire(
      createBackendManager({
        distPath: paths.distPath,
        utilityProcesses: platform.utilityProcesses,
        dlcResources: services.dlcResources,
      }),
    );
    services.ipc = createIPCBridge({
      backendManager: services.backends,
      commandRegistry: commands,
      permissionRegistry: permissions,
      viewManager: services.views,
      runtimeContexts,
      execution,
      rendererIpc: platform.rendererIpc,
      operations,
    });
    services.packages = await effects.acquire(
      createPackageManager({
        appsDirectory: paths.appsDirectory,
        distPath: paths.distPath,
        config,
        permissionRegistry: permissions,
        filesystemManager: services.filesystem,
        registry: packageRegistry,
        catalog,
        dlcResources: services.dlcResources,
        operations: packageOperations,
        runtimeContexts,
      }),
    );
    channels = await effects.acquire(
      createAppChannels({
        channels: platform.appChannels,
        backends: services.backends,
      }),
    );
    services.processes = await effects.acquire(
      createProcessManager({
        backendManager: services.backends,
        viewManager: services.views,
        packageCatalog: catalog,
        packageManager: services.packages,
        appChannelManager: channels,
        sessionContext,
        executionContext: execution,
        config,
        runtimeContexts,
        processMetrics: platform.processMetrics,
        routing: {
          updateRunningApps: services.ipc.updateRunningApps,
          removeBackendSubscriptions:
            services.ipc.eventSubscribers.removeBackendSubscriptions,
        },
      }),
    );
    const store = await effects.acquire(
      createUserStore({ appsDirectory: paths.appsDirectory }),
    );
    services.users = await effects.acquire(
      createUserManager({
        store,
        userDirectory: paths.userDirectory,
        restrictedApps: normalizeAppIds(config.restrictedApps),
      }),
    );
    services.sessions = await effects.acquire(
      createSessionManager({
        users: services.users,
        context: sessionContext,
        operations,
        processes: services.processes,
      }),
    );
    services.daemons = await effects.acquire(
      createDaemonManager({
        catalog,
        processes: services.processes,
        settings: services.settings,
        users: services.users,
      }),
    );
    await effects.acquire(
      connectDaemonLifecycle(
        services.daemons,
        services.processes,
        services.packages,
      ),
    );
    await effects.acquire(
      connectSettingsLifecycle(
        settingsPanels,
        services.sessions,
        services.packages,
        services.daemons,
        grants,
      ),
    );
    await effects.acquire(
      Effect.gen(function* () {
        yield* listen(services.views.viewRemoved, ({ viewId }) =>
          services.ipc.eventSubscribers.removeViewSubscriptions(viewId),
        );
        yield* listen(services.processes.stopped, ({ appId }) =>
          effects.run(services.filesystem.closeOwner({ appId })),
        );
        yield* listen(services.processes.exited, ({ appId }) =>
          effects.run(services.filesystem.closeOwner({ appId })),
        );
      }),
    );
    const i18n = await effects.acquire(
      createI18n({ settings: createI18nSettings(services.settings) }),
    );
    associations = await effects.acquire(
      createAppAssociations({
        catalog,
        storage: createJsonFileAssociationStorage(paths.userDirectory),
      }),
    );
    const fileOpen = await effects.acquire(
      createFileOpen({
        associations,
        catalog,
        processes: createFileOpenProcesses(services.processes),
        views: services.views,
        filesystem: createFileOpenFilesystem(services.filesystem),
        i18n,
      }),
    );
    const fileOpenOperations = createFileOpenOperations(fileOpen, {
      prepareVolumeOperation: services.filesystem.prepareVolumeOperation,
    });
    autostart = await effects.acquire(
      createAutostart({
        development: !!config.development,
        loginAppId: config.loginAppId,
        settings: services.settings,
        sessions: {
          currentUser: sessionContext.getCurrentUser,
          changed: services.sessions.changed,
        },
        processes: createAutostartProcesses(services.processes, execution),
        developmentApps: createDevelopmentAutostart(config),
      }),
    );
    keyboard = await effects.acquire(
      createKeyboard({
        assets: createKeyboardAssets(),
        settings: services.settings,
        views: createKeyboardViews(services.views),
        processes: { stopped: services.processes.stopped },
        windows: platform.windows,
        rendererIpc: platform.rendererIpc,
        display: platform.display,
        run: effects.run,
      }),
    );
    await effects.run(keyboard.initialize());
    const power = await effects.acquire(
      createPower({
        host: createPowerHost(config.powerProvider),
        daemons: services.daemons,
        processes: services.processes,
      }),
    );
    const notifications = await effects.acquire(
      createNotifications({ views: createNotificationViews(services.views) }),
    );
    const contextMenu = await effects.acquire(
      createContextMenu({ views: createContextMenuViews(services.views) }),
    );
    const filePicker = await effects.acquire(
      createFilePicker({
        associations,
        views: createFilePickerViews(services.views),
        processes: createFilePickerProcesses(services.processes),
        files: createFilePickerFiles(services.filesystem),
        volumes: services.volumes,
        permissions,
        notifications: createFilePickerNotifications(notifications),
      }),
    );
    const db = await effects.acquire(
      createDb(createSqliteDbStorage({ appsDirectory: paths.appsDirectory })),
    );
    appearance = await effects.acquire(
      createAppearance({
        settings: createAppearanceSettings(services.settings),
      }),
    );
    const viewInteractions = await effects.acquire(
      createViewInteractions(services.views, platform.display),
    );
    for (const controller of [
      createOperationController(operations),
      createSettingsPanelsController(settingsPanels),
      createBrandingController(branding),
      createSettingsController(services.settings),
      createViewController(services.views, viewInteractions),
      createVolumeController(services.volumes, execution),
      createFilesystemController(services.filesystem),
      createPackageController(services.packages),
      createAppChannelsController(channels),
      createProcessController(services.processes, execution),
      createUserController({
        users: services.users,
        sessions: services.sessions,
        execution,
        grants,
      }),
      createSessionController(services.sessions),
      createDaemonController(services.daemons, execution, services.users),
      createI18nController(i18n),
      createAppAssociationsController(associations),
      createFileOpenController(fileOpen, fileOpenOperations),
      createPowerController(power),
      createNotificationController(notifications),
      createContextMenuController(contextMenu),
      createFilePickerController(filePicker),
      createDbController(db),
      createAppearanceController(appearance),
      createSystemController(config, services.ipc.getRunningAppIds),
    ])
      register(controller);
    controlPlane = createControlPlaneApis({
      packageManager: services.packages,
      daemonManager: services.daemons,
      userManager: services.users,
      sessionManager: services.sessions,
      appearance,
      associationManager: associations,
      volumeManager: services.volumes,
      sdk,
    });
    registerBuiltinSettingsPanels({
      panels: settingsPanels,
      settings: services.settings,
      appearance,
      packageManager: services.packages,
      daemonManager: services.daemons,
      userManager: services.users,
      config,
    });
  }
  async function createMainWindow() {
    const windowConfig = config.window || {};
    const title = branding.getWindowTitle(windowConfig.title);
    const icon = branding.getWindowIconPath();
    mainWindow = platform.windows.createWindow({
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
        preload: path.join(paths.distPath, "foundation/foundation-preload.js"),
        additionalArguments: [`--window-title=${title}`],
      },
      backgroundColor: windowConfig.backgroundColor || "#1e1e1e",
      autoHideMenuBar: true,
      show: false,
    });
    platform.windows.attachWebContentsLogger(mainWindow.webContents, {
      source: "foundation",
    });
    services.views.setMainWindow(mainWindow);
    services.ipc.setMainWindow(mainWindow);
    await effects.run(keyboard.setMainWindow(mainWindow));
    mainWindow.loadFile(
      path.join(paths.distPath, "foundation/foundation.html"),
    );
    mainWindow.webContents.once("did-finish-load", () =>
      autostart.onFoundationReady(),
    );
    mainWindow.once("ready-to-show", () => mainWindow?.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
    });
  }
  function assertStartupActive() {
    if (state !== "starting")
      throw new Error("Eden runtime startup aborted by shutdown");
  }
  async function startInternal() {
    try {
      log.info("Eden starting...");
      await seedDatabase(
        paths.appsDirectory,
        config.seedPath ?? path.join(paths.distPath, "eden-seed.json"),
        paths.userDirectory,
      );
      await initializeServices();
      await effects.run(services.users.initialize());
      await effects.run(services.packages.initialize());
      settingsPanels.synchronizeManifestPanels();
      await effects.run(services.daemons.initialize());
      await effects.run(services.sessions.initialize());
      await effects.run(appearance.initialize());
      await effects.run(associations.initialize());
      assertStartupActive();
      await createMainWindow();
      assertStartupActive();
      state = "ready";
      readySettled = true;
      resolveReady();
      log.info("Eden ready!");
    } catch (error) {
      try {
        await disposeResources();
      } catch (cleanupError) {
        log.error("Error disposing failed Eden startup:", cleanupError);
      } finally {
        if (state !== "stopping") state = "failed";
        readySettled = true;
        rejectReady(error);
      }
      if (state === "failed") log.error("Eden failed to start", error);
      throw error;
    }
  }
  function start() {
    if (state === "starting" && startPromise) return startPromise;
    if (state === "ready") return startPromise ?? Promise.resolve();
    if (state !== "created")
      return Promise.reject(
        new Error(`Cannot start Eden runtime from ${state} state`),
      );
    state = "starting";
    startPromise = startInternal();
    return startPromise;
  }
  async function disposeResources() {
    if (resourcesDisposed) return;
    resourcesDisposed = true;
    async function release(name: string, cleanup: () => void | Promise<void>) {
      try {
        await cleanup();
      } catch (error) {
        log.error(`Failed to dispose Eden ${name}:`, error);
      }
    }

    if (services.filesystem)
      await release("filesystem handles", () =>
        effects.run(services.filesystem.closeHandles()),
      );
    await release("operation drain", operations.shutdown);
    if (autostart)
      await release("autostart", () => effects.run(autostart.shutdown()));
    if (services.daemons)
      await release("daemons", () => effects.run(services.daemons.shutdown()));
    if (services.processes)
      await release("processes", () =>
        effects.run(services.processes.shutdown()),
      );
    await release("foundation window", () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.destroy();
      mainWindow = null;
    });
    await release("IPC", () => services.ipc?.dispose());
    await release("service scopes", effects.dispose);
    await release("grant catalog", grants.dispose);
    await release("settings panels", settingsPanels.dispose);
    await release("command registry", commands.dispose);
    await release("operations", operations.dispose);
    await release("permissions", permissions.dispose);
    await release("runtime contexts", runtimeContexts.dispose);
    await release("session context", sessionContext.dispose);
  }
  function dispose() {
    if (disposePromise) return disposePromise;
    const beforeStart = state === "created";
    state = "stopping";
    if (beforeStart && !readySettled) {
      readySettled = true;
      rejectReady(new Error("Eden runtime disposed before startup"));
    }
    disposePromise = (async () => {
      try {
        if (startPromise) await startPromise.catch(() => undefined);
        await disposeResources();
      } catch (error) {
        log.error("Error during shutdown:", error);
      } finally {
        state = "stopped";
      }
    })();
    return disposePromise;
  }
  function activate() {
    if (state === "ready" && mainWindow === null)
      void createMainWindow().catch((error) =>
        log.error("Failed to activate foundation window:", error),
      );
  }
  return {
    effects,
    services,
    settings,
    start,
    dispose,
    activate,
    whenReady: () => readyPromise,
    get state() {
      return state;
    },
    get operations() {
      return operationsApi;
    },
    get volumes() {
      return operational().volumes;
    },
    get packages() {
      return operational().packages;
    },
    get daemons() {
      return operational().daemons;
    },
    get users() {
      return operational().users;
    },
    get sessions() {
      return operational().sessions;
    },
    get appearance() {
      return operational().appearance;
    },
    get associations() {
      return operational().associations;
    },
  };
}
export type EdenRuntime = ReturnType<typeof createEdenRuntime>;

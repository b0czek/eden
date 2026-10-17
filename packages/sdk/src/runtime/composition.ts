import type { EdenConfig } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { createControlPlaneApis } from "../api/control-plane-controllers";
import { createSdkContext } from "../api/sdk-context";
import {
  createAppAssociations,
  createAppAssociationsController,
  createJsonFileAssociationStorage,
} from "../app-associations";
import { createAppChannels, createAppChannelsController } from "../appbus";
import { createAppearanceController } from "../appearance/controller-edenapi";
import { createAppearance } from "../appearance/service";
import { createAppearanceSettings } from "../appearance/settings-adapter";
import {
  createAutostart,
  createAutostartProcesses,
  createDevelopmentAutostart,
} from "../autostart";
import {
  createBranding,
  createBrandingController,
  createFilesystemBrandingAssets,
} from "../branding";
import {
  createContextMenu,
  createContextMenuController,
  createContextMenuViews,
} from "../context-menu";
import { createDaemonController } from "../daemon/controller-edenapi";
import { connectDaemonLifecycle } from "../daemon/lifecycle";
import { createDaemons, type Daemons } from "../daemon/service";
import { createDb, createDbController, createSqliteDbStorage } from "../db";
import type { EffectRuntime } from "../effects/runtime";
import { listen } from "../events/scoped";
import {
  createExecutionContext,
  type ExecutionContext,
} from "../execution/context";
import {
  createRuntimeContexts,
  type RuntimeContexts,
} from "../execution/runtime-contexts";
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
import { createFilesystem, type Filesystem } from "../filesystem/service";
import { createVolumes, type Volumes } from "../filesystem/volumes";
import { createI18nController } from "../i18n/controller-edenapi";
import { createI18n } from "../i18n/service";
import { createI18nSettings } from "../i18n/settings";
import { type Commands, createCommands } from "../ipc/commands";
import { createPermissions, type Permissions } from "../ipc/permissions";
import { createIpcTransport, type IpcTransport } from "../ipc/transport";
import {
  createKeyboard,
  createKeyboardAssets,
  createKeyboardViews,
} from "../keyboard";
import { log } from "../logging";
import {
  createNotificationController,
  createNotifications,
  createNotificationViews,
} from "../notification";
import { createOperationController } from "../operations/controller-edenapi";
import { createOperationsSdkController } from "../operations/controller-sdk";
import { createOperations, type Operations } from "../operations/service";
import { createPackageCatalog, type PackageCatalog } from "../packages/catalog";
import { createPackageController } from "../packages/controller-edenapi";
import {
  createDlcResources,
  type DlcResources,
} from "../packages/dlc-resources";
import {
  createInstalledPackages,
  type InstalledPackages,
} from "../packages/installed";
import { createDlcResourceProtocols } from "../packages/resource-adapter";
import { createPackages, type Packages } from "../packages/service";
import {
  createPackageTransactions,
  type PackageTransactions,
} from "../packages/transactions";
import type { EdenPlatform } from "../platform/ports";
import { createPower, createPowerController, createPowerHost } from "../power";
import { type Backends, createBackends } from "../processes/backends";
import { createProcessController } from "../processes/controller-edenapi";
import { createProcesses, type Processes } from "../processes/service";
import { createSessionContext, type SessionContext } from "../session/context";
import { createSessionController } from "../session/controller-edenapi";
import { createSessions, type Sessions } from "../session/service";
import { createSettingsController } from "../settings/controller-edenapi";
import { createSettingsPanelsController } from "../settings/controller-edenapi-panels";
import { connectSettingsLifecycle } from "../settings/lifecycle";
import type { PanelRegistry } from "../settings/panel-registry";
import {
  createSettingsPanels,
  type SettingsPanels,
} from "../settings/panel-service";
import { registerBuiltinSettingsPanels } from "../settings/panels";
import { createSettings, type Settings } from "../settings/service";
import { createSqliteSettingsStorage } from "../settings/sqlite-storage";
import { createSystemController } from "../system/controller-edenapi";
import { createUserController } from "../user/controller-edenapi";
import { createGrantCatalog, type GrantCatalog } from "../user/grant-catalog";
import { createUsers, type Users } from "../user/service";
import { createUserStorage } from "../user/storage";
import { normalizeAppIds } from "../utils/normalize";
import { createViewController } from "../views/controller-edenapi";
import { createViewInteractions } from "../views/interactions";
import { createViews, type Views } from "../views/service";
import { createFoundationWindow } from "./foundation-window";
import type { EdenRuntimeOptions } from "./runtime";

export interface RuntimeServices {
  execution: ExecutionContext;
  runtimeContexts: RuntimeContexts;
  sessionContext: SessionContext;
  permissions: Permissions;
  operations: Operations;
  commands: Commands;
  ipc: IpcTransport;
  installedPackages: InstalledPackages;
  catalog: PackageCatalog;
  packageOperations: PackageTransactions;
  dlcResources: DlcResources;
  settings: Settings;
  settingsPanels: SettingsPanels;
  grants: GrantCatalog;
  views: Views;
  backends: Backends;
  filesystem: Filesystem;
  volumes: Volumes;
  packages: Packages;
  processes: Processes;
  users: Users;
  sessions: Sessions;
  daemons: Daemons;
}

/** Acquire the complete domain graph in dependency order within one scope. */
export const composeRuntime = Effect.fn(function* ({
  config,
  paths,
  platform,
  effects,
  registrations,
}: {
  config: EdenConfig;
  paths: EdenRuntimeOptions["paths"];
  platform: EdenPlatform;
  effects: EffectRuntime;
  registrations: PanelRegistry;
}) {
  const execution = createExecutionContext({ config });
  const sessionContext = yield* Effect.acquireRelease(
    Effect.sync(() => createSessionContext()),
    (value) => Effect.sync(value.dispose),
  );
  const runtimeContexts = yield* Effect.acquireRelease(
    Effect.sync(() => createRuntimeContexts({ sessionContext })),
    (value) => Effect.sync(value.dispose),
  );
  const permissions = yield* Effect.acquireRelease(
    Effect.sync(() => createPermissions()),
    (value) => Effect.sync(value.dispose),
  );
  const installedPackages = createInstalledPackages();
  const catalog = createPackageCatalog({
    registry: installedPackages,
    executionContext: execution,
    appsDirectory: paths.appsDirectory,
    distPath: paths.distPath,
  });
  const packageOperations = createPackageTransactions({
    appsDirectory: paths.appsDirectory,
  });

  const branding = yield* createBranding({
    branding: config.branding,
    assets: createFilesystemBrandingAssets(paths.appPath),
  });
  const settings = yield* createSettings({
    storage: createSqliteSettingsStorage({
      appsDirectory: paths.appsDirectory,
    }),
    catalog: { getAppSettings: (appId) => catalog.getApp(appId)?.settings },
    authorization: execution,
  });
  const views = yield* createViews({
    config,
    distPath: paths.distPath,
    settings,
    windows: platform.windows,
  });
  yield* views.initialize();
  const volumes = yield* createVolumes();
  const filesystem = yield* createFilesystem({
    baseDir: paths.userDirectory,
    executionContext: execution,
    volumes,
    views: {
      resolveViewId: views.getViewIdByWebContentsId,
      removed: views.viewRemoved,
    },
  });

  const operations = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createOperations({
        effects,
        execution,
        session: sessionContext,
        filesystem,
      }),
    ),
    (value) => value.dispose(),
  );
  const commands = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createCommands({
        permissions,
        sessionContext,
        executionContext: execution,
        operations,
      }),
    ),
    (value) => Effect.sync(value.dispose),
  );
  const sdk = createSdkContext({ execution, operations });
  const operationsApi = createOperationsSdkController({ operations, sdk });
  const settingsPanels = createSettingsPanels({
    settings,
    packageCatalog: catalog,
    sessionContext,
    executionContext: execution,
    registry: registrations,
  });
  const grants = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createGrantCatalog({ packageCatalog: catalog, settingsPanels }),
    ),
    (value) => Effect.sync(value.dispose),
  );
  for (const [event, permission] of Object.entries({
    "settings/panels-changed": "settings/panels",
    "user/grant-options-changed": "user/manage",
    "fs/changed": "fs/read",
    "volume/changed": "volume/read",
  }))
    permissions.registerEventPermission(event, permission);
  const dlcResources = yield* createDlcResources({
    catalog,
    views,
    protocols: createDlcResourceProtocols(platform.resources, effects.run),
  });
  const backends = yield* createBackends({
    distPath: paths.distPath,
    utilityProcesses: platform.utilityProcesses,
    dlcResources,
  });
  const ipc = yield* createIpcTransport({
    backends,
    commands,
    permissions,
    views,
    runtimeContexts,
    execution,
    rendererIpc: platform.rendererIpc,
    operations,
  });
  const packages = yield* createPackages({
    appsDirectory: paths.appsDirectory,
    distPath: paths.distPath,
    config,
    permissions,
    filesystem,
    registry: installedPackages,
    catalog,
    dlcResources,
    operations: packageOperations,
    runtimeContexts,
  });
  const channels = yield* createAppChannels({
    channels: platform.appChannels,
    backends,
  });
  const processes = yield* createProcesses({
    backends,
    views,
    packageCatalog: catalog,
    packages,
    channels,
    sessionContext,
    executionContext: execution,
    config,
    runtimeContexts,
    processMetrics: platform.processMetrics,
    routing: {
      updateRunningApps: ipc.updateRunningApps,
      removeBackendSubscriptions:
        ipc.eventSubscribers.removeBackendSubscriptions,
    },
  });
  const store = yield* createUserStorage({
    appsDirectory: paths.appsDirectory,
  });
  const users = yield* createUsers({
    store,
    userDirectory: paths.userDirectory,
    restrictedApps: normalizeAppIds(config.restrictedApps),
  });
  const sessions = yield* createSessions({
    users,
    context: sessionContext,
    operations,
    processes,
  });
  const daemons = yield* createDaemons({
    catalog,
    processes,
    settings,
    users,
  });
  yield* connectDaemonLifecycle(daemons, processes, packages);
  yield* connectSettingsLifecycle(
    settingsPanels,
    sessions,
    packages,
    daemons,
    grants,
  );
  yield* Effect.gen(function* () {
    yield* listen(views.viewRemoved, ({ viewId }) =>
      ipc.eventSubscribers.removeViewSubscriptions(viewId),
    );
    yield* listen(processes.stopped, ({ appId }) =>
      effects.run(filesystem.closeOwner({ appId })),
    );
    yield* listen(processes.exited, ({ appId }) =>
      effects.run(filesystem.closeOwner({ appId })),
    );
  });
  const i18n = yield* createI18n({ settings: createI18nSettings(settings) });
  const associations = yield* createAppAssociations({
    catalog,
    storage: createJsonFileAssociationStorage(paths.userDirectory),
  });
  const fileOpen = yield* createFileOpen({
    associations,
    catalog,
    processes: createFileOpenProcesses(processes),
    views,
    filesystem: yield* createFileOpenFilesystem(filesystem),
    i18n,
  });
  const fileOpenOperations = createFileOpenOperations(fileOpen, {
    prepareVolumeOperation: filesystem.prepareVolumeOperation,
  });
  const autostart = yield* createAutostart({
    development: !!config.development,
    loginAppId: config.loginAppId,
    settings,
    sessions: {
      currentUser: sessionContext.getCurrentUser,
      changed: sessions.changed,
    },
    processes: createAutostartProcesses(processes, execution),
    developmentApps: createDevelopmentAutostart(config),
  });
  const keyboard = yield* createKeyboard({
    assets: createKeyboardAssets(),
    settings,
    views: createKeyboardViews(views),
    processes: { stopped: processes.stopped },
    windows: platform.windows,
    rendererIpc: platform.rendererIpc,
    display: platform.display,
    run: effects.run,
  });
  yield* keyboard.initialize();
  const power = yield* createPower({
    host: createPowerHost(config.powerProvider),
    daemons,
    processes,
  });
  const notifications = yield* createNotifications({
    views: createNotificationViews(views),
  });
  const contextMenu = yield* createContextMenu({
    views: createContextMenuViews(views),
  });
  const filePicker = yield* createFilePicker({
    associations,
    views: createFilePickerViews(views),
    processes: createFilePickerProcesses(processes),
    files: createFilePickerFiles(filesystem),
    volumes,
    permissions,
    notifications: createFilePickerNotifications(notifications),
  });
  const db = yield* createDb(
    createSqliteDbStorage({ appsDirectory: paths.appsDirectory }),
  );
  const appearance = yield* createAppearance({
    settings: createAppearanceSettings(settings),
  });
  const viewInteractions = yield* createViewInteractions(
    views,
    platform.display,
  );
  for (const controller of [
    createOperationController(operations),
    createSettingsPanelsController(settingsPanels),
    createBrandingController(branding),
    createSettingsController(settings),
    createViewController(views, viewInteractions),
    createVolumeController(volumes, execution),
    createFilesystemController(filesystem),
    createPackageController(packages),
    createAppChannelsController(channels),
    createProcessController(processes, execution),
    createUserController({
      users,
      sessions,
      execution,
      grants,
    }),
    createSessionController(sessions),
    createDaemonController(daemons, execution, users),
    createI18nController(i18n),
    createAppAssociationsController(associations),
    createFileOpenController(fileOpen, fileOpenOperations),
    createPowerController(power),
    createNotificationController(notifications),
    createContextMenuController(contextMenu),
    createFilePickerController(filePicker),
    createDbController(db),
    createAppearanceController(appearance),
    createSystemController(config, ipc.getRunningAppIds),
  ])
    ipc.registerController(controller);
  const controlPlane = createControlPlaneApis({
    packages,
    daemons,
    users,
    sessions,
    appearance,
    associations,
    volumes,
    sdk,
  });
  registerBuiltinSettingsPanels({
    panels: settingsPanels,
    settings,
    appearance,
    packages,
    daemons,
    users,
    config,
  });

  const services = {
    execution,
    runtimeContexts,
    sessionContext,
    permissions,
    operations,
    commands,
    ipc,
    installedPackages,
    catalog,
    packageOperations,
    dlcResources,
    settings,
    settingsPanels,
    grants,
    views,
    backends,
    filesystem,
    volumes,
    packages,
    processes,
    users,
    sessions,
    daemons,
  } satisfies RuntimeServices;
  const foundation = yield* createFoundationWindow({
    config,
    paths,
    platform,
    branding,
    views,
    ipc,
    keyboard,
    autostart,
  });
  const shutdown = Effect.fn(function* () {
    operations.closeAdmission();
    yield* shutdownPhase("filesystem handles", filesystem.closeHandles());
    yield* shutdownPhase("operation drain", operations.shutdown());
    yield* shutdownPhase("autostart", autostart.shutdown());
    yield* shutdownPhase("daemons", daemons.shutdown());
    yield* shutdownPhase("processes", processes.shutdown());
  });
  return {
    services,
    controlPlane,
    operationsApi,
    foundation,
    appearance,
    associations,
    shutdown,
  };
});

function shutdownPhase<A, E>(name: string, work: Effect.Effect<A, E>) {
  return Effect.catchCause(work, (cause) =>
    Effect.sync(() =>
      log.error(`Failed to shut down Eden ${name}:`, Cause.squash(cause)),
    ),
  );
}
export type RuntimeBundle = Effect.Success<ReturnType<typeof composeRuntime>>;

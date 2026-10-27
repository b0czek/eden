import * as path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  AppAssociationsPortsLive,
  registerAppAssociationsApi,
} from "../applications/app-associations/runtime";
import { AppAssociationsLive } from "../applications/app-associations/service";
import {
  AppChannelTransportLive,
  registerAppChannelsApi,
} from "../applications/appbus/runtime";
import { AppChannelsLive } from "../applications/appbus/service";
import { AutostartPortsLive } from "../applications/autostart/runtime";
import { AutostartLive } from "../applications/autostart/service";
import { registerDaemonsApi } from "../applications/daemon/runtime";
import { DaemonsLive } from "../applications/daemon/service";
import { PackageCatalogLive } from "../applications/packages/catalog";
import { DlcResourcesLive } from "../applications/packages/dlc-resources";
import { InstalledPackagesLive } from "../applications/packages/installed";
import {
  DlcResourcesPortsLive,
  registerPackagesApi,
} from "../applications/packages/runtime";
import { PackagesLive } from "../applications/packages/service";
import { PackageTransactionsLive } from "../applications/packages/transactions";
import { BackendsLive } from "../applications/processes/backends";
import { registerProcessesApi } from "../applications/processes/runtime";
import { ProcessesLive } from "../applications/processes/service";
import { ExecutionContextLive } from "../core/execution/context";
import { RuntimeContextsLive } from "../core/execution/runtime-contexts";
import { I18nSettingsLive, registerI18nApi } from "../core/i18n/runtime";
import { I18nLive } from "../core/i18n/service";
import { CommandsLive } from "../core/ipc/commands";
import { PermissionsLive } from "../core/ipc/permissions";
import { IpcTransportLive } from "../core/ipc/transport";
import {
  OperationTransitionPreparationLive,
  registerOperationsApi,
} from "../core/operations/runtime";
import { OperationsLive } from "../core/operations/service";
import { PanelRegistry } from "../core/settings/panels/registry";
import { registerSettingsPanelsApi } from "../core/settings/panels/runtime";
import { SettingsPanelsLive } from "../core/settings/panels/service";
import {
  registerSettingsApi,
  SettingsCatalogLive,
} from "../core/settings/runtime";
import { SettingsLive } from "../core/settings/service";
import { SqliteSettingsStorageLive } from "../core/settings/sqlite-storage";
import { GrantCatalogLive } from "../core/user/grant-catalog";
import { registerUsersApi, UsersPortsLive } from "../core/user/runtime";
import { UsersLive } from "../core/user/service";
import { UserStorageLive } from "../core/user/storage";
import {
  AppearanceSettingsLive,
  registerAppearanceApi,
} from "../desktop/appearance/runtime";
import { AppearanceLive } from "../desktop/appearance/service";
import {
  BrandingPortsLive,
  registerBrandingApi,
} from "../desktop/branding/runtime";
import { BrandingLive } from "../desktop/branding/service";
import {
  ContextMenuPortsLive,
  registerContextMenuApi,
} from "../desktop/context-menu/runtime";
import { ContextMenuLive } from "../desktop/context-menu/service";
import { registerFileOpenApi } from "../desktop/file-open/runtime";
import { FileOpenLive } from "../desktop/file-open/service";
import {
  FilePickerViewsLive,
  registerFilePickerApi,
} from "../desktop/file-picker/runtime";
import { FilePickerLive } from "../desktop/file-picker/service";
import { KeyboardPortsLive } from "../desktop/keyboard/runtime";
import { KeyboardLive } from "../desktop/keyboard/service";
import {
  NotificationsPortsLive,
  registerNotificationsApi,
} from "../desktop/notification/runtime";
import { NotificationsLive } from "../desktop/notification/service";
import { PowerHostLive, registerPowerApi } from "../desktop/power/runtime";
import { PowerLive } from "../desktop/power/service";
import { SessionContextLive } from "../desktop/session/context";
import { registerSessionsApi } from "../desktop/session/runtime";
import { SessionsLive } from "../desktop/session/service";
import { registerSystemApi } from "../desktop/system/runtime";
import { registerViewsApi } from "../desktop/views/runtime";
import { ViewsLive } from "../desktop/views/service";
import { registerDbApi } from "../platform/db/runtime";
import { DbLive } from "../platform/db/service";
import { SqliteDbStorageLive } from "../platform/db/sqlite-storage";
import {
  FilesystemPortsLive,
  registerFilesystemApi,
} from "../platform/filesystem/runtime";
import { FilesystemLive } from "../platform/filesystem/service";
import { registerVolumesApi } from "../platform/filesystem/volumes/runtime";
import { VolumesLive } from "../platform/filesystem/volumes/service";
import { log } from "../platform/logging/logger";
import {
  DisplayPort,
  ProcessMetricsPort,
  RendererIpcPort,
  UtilityProcessPort,
  WindowingPort,
} from "../platform/ports/types";
import { seedDatabase } from "../platform/seed/seed";
import { assembleDesktop, Desktop } from "./desktop";
import { RuntimeEnvironment } from "./environment";
import {
  AppsDirectory,
  DistPath,
  RuntimeConfig,
  UserDirectory,
} from "./inputs";

/** Host capabilities, execution contexts, and persistent stores. */
const PlatformPersistenceLive = Layer.mergeAll(
  ExecutionContextLive,
  SessionContextLive,
  PermissionsLive,
  InstalledPackagesLive,
  PackageTransactionsLive,
  BrandingLive.pipe(Layer.provide(BrandingPortsLive)),
  VolumesLive,
  UsersLive.pipe(Layer.provide([UsersPortsLive, UserStorageLive])),
  DbLive.pipe(Layer.provide(SqliteDbStorageLive)),
);

/** Catalogs and settings support the shared view and preference services. */
const CoreServicesLive = Layer.mergeAll(
  ViewsLive,
  SettingsPanelsLive,
  I18nLive.pipe(Layer.provide(I18nSettingsLive)),
  AppAssociationsLive.pipe(Layer.provide(AppAssociationsPortsLive)),
  AppearanceLive.pipe(Layer.provide(AppearanceSettingsLive)),
).pipe(
  Layer.provideMerge(
    SettingsLive.pipe(
      Layer.provide([SettingsCatalogLive, SqliteSettingsStorageLive]),
    ),
  ),
  Layer.provideMerge([RuntimeContextsLive, PackageCatalogLive]),
);

/** Files and domain adapters support operations, backends, and app commands. */
const ApplicationServicesLive = Layer.mergeAll(
  CommandsLive,
  PackagesLive,
  AppChannelsLive.pipe(Layer.provide(AppChannelTransportLive)),
).pipe(
  Layer.provideMerge([
    OperationsLive.pipe(Layer.provide(OperationTransitionPreparationLive)),
    BackendsLive,
  ]),
  Layer.provideMerge([
    FilesystemLive.pipe(Layer.provide(FilesystemPortsLive)),
    DlcResourcesLive.pipe(Layer.provide(DlcResourcesPortsLive)),
    NotificationsLive.pipe(Layer.provide(NotificationsPortsLive)),
    ContextMenuLive.pipe(Layer.provide(ContextMenuPortsLive)),
    GrantCatalogLive,
  ]),
);

/** IPC and processes support sessions and desktop interactions. */
const DesktopIntegrationLive = Layer.mergeAll(
  AutostartLive.pipe(Layer.provide(AutostartPortsLive)),
  PowerLive.pipe(Layer.provide(PowerHostLive)),
  FilePickerLive.pipe(Layer.provide(FilePickerViewsLive)),
).pipe(
  Layer.provideMerge([
    SessionsLive,
    DaemonsLive,
    FileOpenLive,
    KeyboardLive.pipe(Layer.provide(KeyboardPortsLive)),
  ]),
  Layer.provideMerge(ProcessesLive),
  Layer.provideMerge(IpcTransportLive),
);

/** Provide each group's dependencies and retain all services for API assembly. */
const ServicesLive = DesktopIntegrationLive.pipe(
  Layer.provideMerge(ApplicationServicesLive),
  Layer.provideMerge(CoreServicesLive),
  Layer.provideMerge(PlatformPersistenceLive),
);

/** API registration follows complete service acquisition and precedes startup. */
const ApiLive = Layer.effectDiscard(
  Effect.all(
    [
      registerAppearanceApi,
      registerAppAssociationsApi,
      registerAppChannelsApi,
      registerBrandingApi,
      registerContextMenuApi,
      registerDaemonsApi,
      registerDbApi,
      registerFileOpenApi,
      registerFilePickerApi,
      registerFilesystemApi,
      registerVolumesApi,
      registerI18nApi,
      registerNotificationsApi,
      registerOperationsApi,
      registerPackagesApi,
      registerPowerApi,
      registerProcessesApi,
      registerSessionsApi,
      registerSettingsApi,
      registerSettingsPanelsApi,
      registerUsersApi,
      registerViewsApi,
      registerSystemApi,
    ],
    { discard: true },
  ),
).pipe(Layer.provideMerge(ServicesLive));

/** Seed persistence before acquiring any services that consume it. */
export function createDesktopLayer(environment: RuntimeEnvironment) {
  const host = Layer.effectContext(
    Effect.gen(function* () {
      log.info("Eden starting...");
      const { paths, config, platform, registrations } = environment;
      yield* seedDatabase(
        paths.appsDirectory,
        config.seedPath ?? path.join(paths.distPath, "eden-seed.json"),
        paths.userDirectory,
      );
      return Context.make(RuntimeEnvironment, environment).pipe(
        Context.add(RuntimeConfig, config),
        Context.add(AppsDirectory, paths.appsDirectory),
        Context.add(UserDirectory, paths.userDirectory),
        Context.add(DistPath, paths.distPath),
        Context.add(PanelRegistry, registrations),
        Context.add(WindowingPort, platform.windows),
        Context.add(RendererIpcPort, platform.rendererIpc),
        Context.add(UtilityProcessPort, platform.utilityProcesses),
        Context.add(DisplayPort, platform.display),
        Context.add(ProcessMetricsPort, platform.processMetrics),
      );
    }),
  );
  return Layer.effect(Desktop, assembleDesktop()).pipe(
    Layer.provide(ApiLive),
    Layer.provide(host),
  );
}

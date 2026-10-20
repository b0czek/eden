import * as path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  AppAssociationsPortsLive,
  registerAppAssociationsApi,
} from "../app-associations/runtime";
import { AppAssociationsLive } from "../app-associations/service";
import {
  AppChannelsPortsLive,
  registerAppChannelsApi,
} from "../appbus/runtime";
import { AppChannelsLive } from "../appbus/service";
import {
  AppearancePortsLive,
  registerAppearanceApi,
} from "../appearance/runtime";
import { AppearanceLive } from "../appearance/service";
import { AutostartPortsLive } from "../autostart/runtime";
import { AutostartLive } from "../autostart/service";
import { BrandingPortsLive, registerBrandingApi } from "../branding/runtime";
import { BrandingLive } from "../branding/service";
import {
  ContextMenuPortsLive,
  registerContextMenuApi,
} from "../context-menu/runtime";
import { ContextMenuLive } from "../context-menu/service";
import { registerDaemonsApi } from "../daemon/runtime";
import { DaemonsLive } from "../daemon/service";
import { registerDbApi } from "../db/runtime";
import { DbLive } from "../db/service";
import { SqliteDbStorageLive } from "../db/sqlite-storage";
import { ExecutionContextLive } from "../execution/context";
import { RuntimeContextsLive } from "../execution/runtime-contexts";
import { FileOpenPortsLive, registerFileOpenApi } from "../file-open/runtime";
import { FileOpenLive } from "../file-open/service";
import {
  FilePickerPortsLive,
  registerFilePickerApi,
} from "../file-picker/runtime";
import { FilePickerLive } from "../file-picker/service";
import {
  FilesystemPortsLive,
  registerFilesystemApi,
} from "../filesystem/runtime";
import { FilesystemLive } from "../filesystem/service";
import { VolumesLive } from "../filesystem/volumes";
import { I18nPortsLive, registerI18nApi } from "../i18n/runtime";
import { I18nLive } from "../i18n/service";
import { CommandsLive } from "../ipc/commands";
import { PermissionsLive } from "../ipc/permissions";
import { IpcTransportLive } from "../ipc/transport";
import { KeyboardPortsLive } from "../keyboard/runtime";
import { KeyboardLive } from "../keyboard/service";
import { log } from "../logging";
import {
  NotificationsPortsLive,
  registerNotificationsApi,
} from "../notification/runtime";
import { NotificationsLive } from "../notification/service";
import { registerOperationsApi } from "../operations/runtime";
import { OperationsLive } from "../operations/service";
import { PackageCatalogLive } from "../packages/catalog";
import { DlcResourcesLive } from "../packages/dlc-resources";
import { InstalledPackagesLive } from "../packages/installed";
import {
  DlcResourcesPortsLive,
  registerPackagesApi,
} from "../packages/runtime";
import { PackagesLive } from "../packages/service";
import { PackageTransactionsLive } from "../packages/transactions";
import {
  DisplayPort,
  ProcessMetricsPort,
  RendererIpcPort,
  UtilityProcessPort,
  WindowingPort,
} from "../platform/ports/types";
import { PowerHostLive, registerPowerApi } from "../power/runtime";
import { PowerLive } from "../power/service";
import { BackendsLive } from "../processes/backends";
import { ProcessesPortsLive, registerProcessesApi } from "../processes/runtime";
import { ProcessesLive } from "../processes/service";
import { seedDatabase } from "../seed";
import { SessionContextLive } from "../session/context";
import { registerSessionsApi } from "../session/runtime";
import { SessionsLive } from "../session/service";
import { PanelRegistryService } from "../settings/panels/registry";
import { registerSettingsPanelsApi } from "../settings/panels/runtime";
import { SettingsPanelsLive } from "../settings/panels/service";
import { registerSettingsApi, SettingsPortsLive } from "../settings/runtime";
import { SettingsLive } from "../settings/service";
import { SqliteSettingsStorageLive } from "../settings/sqlite-storage";
import { registerSystemApi } from "../system/runtime";
import { GrantCatalogLive } from "../user/grant-catalog";
import { registerUsersApi, UsersPortsLive } from "../user/runtime";
import { UsersLive } from "../user/service";
import { UserStorageLive } from "../user/storage";
import { registerViewsApi } from "../views/runtime";
import { ViewsLive } from "../views/service";
import { assembleDesktop, Desktop } from "./desktop";
import { RuntimeEnvironment } from "./environment";
import {
  AppsDirectory,
  DistPath,
  RuntimeConfig,
  UserDirectory,
} from "./inputs";

/** Wire implementations once; domain Layers declare only their requirements. */
const ServicesLive = Layer.mergeAll(
  AutostartLive.pipe(Layer.provide(AutostartPortsLive)),
  PowerLive.pipe(Layer.provide(PowerHostLive)),
  FilePickerLive.pipe(Layer.provide(FilePickerPortsLive)),
).pipe(
  Layer.provideMerge([
    SessionsLive,
    DaemonsLive,
    FileOpenLive.pipe(Layer.provide(FileOpenPortsLive)),
    KeyboardLive.pipe(Layer.provide(KeyboardPortsLive)),
  ]),
  Layer.provideMerge(ProcessesLive.pipe(Layer.provide(ProcessesPortsLive))),
  Layer.provideMerge(IpcTransportLive),
  Layer.provideMerge([
    CommandsLive,
    PackagesLive,
    AppChannelsLive.pipe(Layer.provide(AppChannelsPortsLive)),
  ]),
  Layer.provideMerge([OperationsLive, BackendsLive]),
  Layer.provideMerge([
    FilesystemLive.pipe(Layer.provide(FilesystemPortsLive)),
    DlcResourcesLive.pipe(Layer.provide(DlcResourcesPortsLive)),
    NotificationsLive.pipe(Layer.provide(NotificationsPortsLive)),
    ContextMenuLive.pipe(Layer.provide(ContextMenuPortsLive)),
    GrantCatalogLive,
  ]),
  Layer.provideMerge([
    ViewsLive,
    SettingsPanelsLive,
    I18nLive.pipe(Layer.provide(I18nPortsLive)),
    AppAssociationsLive.pipe(Layer.provide(AppAssociationsPortsLive)),
    AppearanceLive.pipe(Layer.provide(AppearancePortsLive)),
  ]),
  Layer.provideMerge(
    SettingsLive.pipe(
      Layer.provide([SettingsPortsLive, SqliteSettingsStorageLive]),
    ),
  ),
  Layer.provideMerge([RuntimeContextsLive, PackageCatalogLive]),
  Layer.provideMerge([
    ExecutionContextLive,
    SessionContextLive,
    PermissionsLive,
    InstalledPackagesLive,
    PackageTransactionsLive,
    BrandingLive.pipe(Layer.provide(BrandingPortsLive)),
    VolumesLive,
    UsersLive.pipe(Layer.provide([UsersPortsLive, UserStorageLive])),
    DbLive.pipe(Layer.provide(SqliteDbStorageLive)),
  ]),
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
        Context.add(PanelRegistryService, registrations),
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

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type {
  FilesystemLocation,
  InstalledPackageInfo,
  InstalledPackageManifest,
  PackageInfo,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { fromPromise } from "../effects/io";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import { RuntimeContexts } from "../execution/runtime-contexts";
import { Filesystem } from "../filesystem/service";
import type { VolumeUnavailable } from "../filesystem/volumes/errors";
import { Permissions } from "../ipc/permissions";
import { log } from "../logging/logger";
import type { OperationReporter, OperationTask } from "../operations/task";
import { AppsDirectory, DistPath, RuntimeConfig } from "../runtime/inputs";
import { PackageCatalog } from "./catalog";
import { createPackageDevelopment } from "./development";
import { createPackageDiscovery } from "./discovery";
import { DlcResources } from "./dlc-resources";
import type {
  PackageArchiveInstallError,
  PackageDevelopmentFailure,
  PackageInstallError,
  PackageRemovalError,
} from "./errors";
import {
  PackageArchiveError,
  PackageInitializationError,
  PackageJournalError,
  PackageLocationError,
  PackageRejected,
  PackageRollbackError,
  PackageTransactionError,
} from "./errors";
import { InstalledPackages } from "./installed";
import { createPackageManifests } from "./manifests";
import { createPackageMutations } from "./mutations";
import { PackageTransactions } from "./transactions";
import type {
  InstalledPackageListOptions,
  PackageNamespaceEvents,
} from "./types";

export interface Packages {
  installed: Event<PackageNamespaceEvents["installed"]>;
  uninstalled: Event<PackageNamespaceEvents["uninstalled"]>;
  initialize: () => Effect.Effect<void, PackageInitializationError>;
  getPackageInfo: (location: FilesystemLocation) => Effect.Effect<PackageInfo>;
  getPackageInfoFromHostPath: (hostPath: string) => Effect.Effect<PackageInfo>;
  listInstalledPackages: {
    (
      options: InstalledPackageListOptions & { kind: "app" },
    ): RuntimeAppManifest[];
    (
      options: InstalledPackageListOptions & { kind: "dlc" },
    ): RuntimeDlcManifest[];
    (options?: InstalledPackageListOptions): InstalledPackageManifest[];
  };
  getInstalledPackage: (
    packageId: string,
  ) => InstalledPackageManifest | undefined;
  getAppForLaunch: (appId: string) => RuntimeAppManifest | undefined;
  getInstalledPackageInfo: (
    packageId: string,
    webContentsId?: number,
  ) => InstalledPackageInfo | undefined;
  getPackageIcon: (packageId: string) => Effect.Effect<string | undefined>;
  getPackageSize: (packageId: string) => Effect.Effect<number | undefined>;
  prepareInstallPackage: (
    location: FilesystemLocation,
    replacementConfirmed?: boolean,
  ) => OperationTask<
    InstalledPackageManifest,
    PackageInstallError | VolumeUnavailable
  >;
  installPackage: (
    location: FilesystemLocation,
    replacementConfirmed?: boolean,
    reporter?: OperationReporter | undefined,
  ) => Effect.Effect<
    RuntimeAppManifest | RuntimeDlcManifest,
    PackageInstallError
  >;
  installPackageFromHostPath: (
    hostPath: string,
    replacementConfirmed?: boolean,
    reporter?: OperationReporter | undefined,
  ) => Effect.Effect<
    RuntimeAppManifest | RuntimeDlcManifest,
    PackageArchiveInstallError
  >;
  uninstallPackage: (
    packageId: string,
    reporter?: OperationReporter | undefined,
  ) => Effect.Effect<boolean, PackageRemovalError>;
  reloadPackage: (
    packageId: string,
  ) => Effect.Effect<undefined, PackageDevelopmentFailure>;
  isHotReloadEnabled: (
    packageId: string,
  ) => Effect.Effect<boolean, PackageRejected>;
  toggleHotReload: (
    packageId: string,
  ) => Effect.Effect<boolean, PackageDevelopmentFailure>;
}

export const Packages = Context.Service<"eden/Packages", Packages>(
  "eden/Packages",
);

export const PackagesLive = Layer.effect(
  Packages,
  Effect.gen(function* () {
    const appsDirectory = yield* AppsDirectory;
    const distPath = yield* DistPath;
    const config = yield* RuntimeConfig;
    const permissions = yield* Permissions;
    const filesystem = yield* Filesystem;
    const registry = yield* InstalledPackages;
    const catalog = yield* PackageCatalog;
    const dlcResources = yield* DlcResources;
    const operations = yield* PackageTransactions;
    const runtimeContexts = yield* RuntimeContexts;
    const prebuiltPackagesDirectory = path.join(distPath, "apps", "prebuilt");
    const installed = yield* scopedEvent<PackageNamespaceEvents["installed"]>();
    const uninstalled =
      yield* scopedEvent<PackageNamespaceEvents["uninstalled"]>();
    const manifests = createPackageManifests(config);
    const discovery = createPackageDiscovery({
      appsDirectory,
      prebuiltPackagesDirectory,
      config,
      registry,
      catalog,
      permissions,
      manifests,
    });
    const mutations = createPackageMutations({
      appsDirectory,
      catalog,
      registry,
      permissions,
      runtimeContexts,
      manifests,
      operations,
      installed,
      uninstalled,
    });
    const {
      installPackageFromHostPath,
      uninstallPackage,
      getIncompatibleDlcs,
    } = mutations;
    const { reloadPackage, isHotReloadEnabled, toggleHotReload } =
      createPackageDevelopment({
        config,
        catalog,
        registry,
        permissions,
        manifests,
        installed,
        getIncompatibleDlcs,
      });
    const initialize = Effect.fn(
      function* () {
        // Ensure apps directory exists
        yield* fromPromise(() => fs.mkdir(appsDirectory, { recursive: true }));
        yield* fromPromise(() =>
          fs.mkdir(catalog.dlcDirectory, { recursive: true }),
        );
        yield* operations.initialize();
        // Discover built-in packages and register apps before resolving DLC hosts.
        const prebuiltDlcs = yield* discovery.loadPrebuiltPackages();
        const prebuiltDlcIds = new Set(prebuiltDlcs.map((dlc) => dlc.id));
        // Load installed apps
        yield* discovery.loadInstalledApps(prebuiltDlcIds);
        // Development sources intentionally win over installed and prebuilt apps.
        if (config.development) {
          yield* discovery.loadDevelopmentApps(prebuiltDlcIds);
        }
        yield* discovery.loadPrebuiltDlcs(prebuiltDlcs);
        yield* discovery.loadInstalledDlcs(prebuiltDlcIds);
        const prebuiltAppCount = catalog.prebuiltApps().length;
        const installedAppCount = catalog.installedApps().length;
        const prebuiltDlcCount = catalog
          .allDlcs()
          .filter((dlc) => dlc.isPrebuilt).length;
        const installedDlcCount = catalog.allDlcs().length - prebuiltDlcCount;
        log.info(
          `Packages initialized. Found ${prebuiltAppCount} built-in apps, ${prebuiltDlcCount} built-in DLCs, ${installedAppCount} installed apps, and ${installedDlcCount} installed DLCs.`,
        );
      },
      Effect.mapError(
        (cause) =>
          new PackageInitializationError({ message: cause.message, cause }),
      ),
    );
    const getPackageInfo: (
      location: FilesystemLocation,
    ) => Effect.Effect<PackageInfo> = Effect.fn(function* (
      location: FilesystemLocation,
    ) {
      return yield* Effect.catch(
        Effect.gen(function* () {
          return yield* filesystem.withVolume(location, (hostPath) =>
            getPackageInfoFromHostPath(hostPath),
          );
        }),
        (error) =>
          Effect.sync(() => {
            return { success: false, error: (error as Error).message };
          }),
      );
    });
    const getPackageInfoFromHostPath: (
      hostPath: string,
    ) => Effect.Effect<PackageInfo> = Effect.fn(function* (hostPath: string) {
      return yield* Effect.catch(
        Effect.gen(function* () {
          const resolvedPath = path.resolve(hostPath);
          const info = yield* fromPromise(() =>
            genesisBundler.getInfo(resolvedPath),
          );
          if (!info.success || !info.manifest) return info;
          const manifest = info.manifest;
          if (manifest.kind === "dlc") {
            const host = catalog.getApp(manifest.hostAppId);
            const existing = catalog.getDlc(manifest.id);
            const compatibilityErrors = host
              ? genesisBundler.isDlcCompatible(host, manifest).errors
              : [`Host app ${manifest.hostAppId} is not installed`];
            return {
              ...info,
              preview: {
                kind: "dlc" as const,
                existingVersion: existing?.version,
                host,
                compatibilityErrors,
                hostRunning:
                  (!!host && !!runtimeContexts.get(host.id)) ||
                  (!!existing && !!runtimeContexts.get(existing.hostAppId)),
                replaceable: !existing?.isPrebuilt,
              },
            };
          }
          const existing = catalog.getApp(manifest.id);
          const incompatibleDlcs = getIncompatibleDlcs(manifest);
          return {
            ...info,
            preview: {
              kind: "app" as const,
              existingVersion: existing?.version,
              incompatibleDlcs,
              hostRunning: !!existing && !!runtimeContexts.get(existing.id),
              replaceable:
                (!existing ||
                  (!existing.isPrebuilt && !existing.isDevelopment)) &&
                incompatibleDlcs.every((dlc) => !dlc.isPrebuilt),
            },
          };
        }),
        (error) =>
          Effect.sync(() => {
            return {
              success: false,
              error: (error as Error).message,
            };
          }),
      );
    });
    function listInstalledPackages(
      options: InstalledPackageListOptions & { kind: "app" },
    ): RuntimeAppManifest[];
    function listInstalledPackages(
      options: InstalledPackageListOptions & { kind: "dlc" },
    ): RuntimeDlcManifest[];
    function listInstalledPackages(
      options?: InstalledPackageListOptions,
    ): InstalledPackageManifest[];
    function listInstalledPackages(
      options: InstalledPackageListOptions = {},
    ): InstalledPackageManifest[] {
      const apps = options.kind === "dlc" ? [] : catalog.listApps(options);
      const dlcs =
        options.kind === "app"
          ? []
          : options.hostAppId
            ? catalog.dlcsForHost(options.hostAppId)
            : catalog.allDlcs();
      return [...apps, ...dlcs];
    }
    function getInstalledPackage(
      packageId: string,
    ): InstalledPackageManifest | undefined {
      return catalog.get(packageId);
    }
    function getAppForLaunch(appId: string): RuntimeAppManifest | undefined {
      return mutations.isHostChanging(appId)
        ? undefined
        : catalog.getApp(appId);
    }
    function getInstalledPackageInfo(
      packageId: string,
      webContentsId?: number,
    ): InstalledPackageInfo | undefined {
      const manifest = getInstalledPackage(packageId);
      if (!manifest) return undefined;
      if (manifest.kind === "dlc") return { manifest, dlcs: [] };
      return {
        manifest,
        dlcs: dlcResources.list(manifest.id, webContentsId),
      };
    }
    const getPackageIcon = catalog.getIcon;
    const getPackageSize = catalog.getSize;
    function prepareInstallPackage(
      location: FilesystemLocation,
      replacementConfirmed: boolean = false,
    ): OperationTask<
      InstalledPackageManifest,
      PackageInstallError | VolumeUnavailable
    > {
      return filesystem.prepareVolumeOperation([location.volume], (reporter) =>
        installPackage(location, replacementConfirmed, reporter),
      );
    }
    const installPackage = Effect.fn(function* (
      location: FilesystemLocation,
      replacementConfirmed: boolean = false,
      reporter?: OperationReporter,
    ) {
      return yield* filesystem
        .withVolume(location, (hostPath) =>
          installPackageFromHostPath(hostPath, replacementConfirmed, reporter),
        )
        .pipe(
          Effect.mapError((cause) =>
            cause instanceof PackageLocationError ||
            cause instanceof PackageRejected ||
            cause instanceof PackageArchiveError ||
            cause instanceof PackageTransactionError ||
            cause instanceof PackageRollbackError ||
            cause instanceof PackageJournalError
              ? cause
              : new PackageLocationError({
                  location,
                  message: cause.message,
                  cause,
                }),
          ),
        );
    });
    return {
      installed,
      uninstalled,
      initialize,
      getPackageInfo,
      getPackageInfoFromHostPath,
      listInstalledPackages,
      getInstalledPackage,
      getAppForLaunch,
      getInstalledPackageInfo,
      getPackageIcon,
      getPackageSize,
      prepareInstallPackage,
      installPackage,
      installPackageFromHostPath,
      uninstallPackage,
      reloadPackage,
      isHotReloadEnabled,
      toggleHotReload,
    };
  }),
);

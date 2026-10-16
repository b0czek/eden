import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type {
  AppManifest,
  DlcManifest,
  EdenConfig,
  FilesystemLocation,
  InstalledPackageInfo,
  InstalledPackageManifest,
  PackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { EdenPackageInfo } from "../api/ControlPlaneApi";
import { asError, fromPromise } from "../effects/io";
import { scopedEvent } from "../events/scoped";
import type { RuntimeContextRegistry } from "../execution/RuntimeContextRegistry";
import type { FilesystemManager } from "../filesystem";
import {
  isHotReloadEnabled as readHotReloadEnabled,
  toggleHotReload as updateHotReload,
} from "../hotreload-config";
import type { PermissionRegistry } from "../ipc/PermissionRegistry";
import { log } from "../logging";
import type {
  OperationReporter,
  OperationTask,
} from "../operations/OperationTask";
import type { DlcResourceManager } from "./DlcResourceManager";
import { createPackageDiscovery } from "./discovery";
import { createPackageManifests } from "./manifests";
import type { PackageCatalog } from "./PackageCatalog";
import type { PackageOperationCoordinator } from "./PackageOperationCoordinator";
import type { PackageRegistry } from "./PackageRegistry";

/**
 * Events emitted by the PackageManager
 */
interface PackageNamespaceEvents {
  installed: {
    manifest: InstalledPackageManifest;
  };
  uninstalled:
    | {
        kind: "app";
        packageId: string;
      }
    | {
        kind: "dlc";
        packageId: string;
        hostAppId: string;
      };
}
const RESERVED_PACKAGE_IDS = new Set([
  "com.eden",
  "settings.db",
  "settings.db-shm",
  "settings.db-wal",
  "storage.db",
  "storage.db-shm",
  "storage.db-wal",
  "users.db",
  "users.db-shm",
  "users.db-wal",
]);
export interface InstalledPackageListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
  kind?: "app" | "dlc";
  hostAppId?: string;
}

export interface PackageManagerDependencies {
  appsDirectory: string;
  distPath: string;
  config: EdenConfig;
  permissionRegistry: Pick<PermissionRegistry, "registerApp" | "unregisterApp">;
  filesystemManager: Pick<
    FilesystemManager,
    "withVolume" | "prepareVolumeOperation"
  >;
  registry: PackageRegistry;
  catalog: PackageCatalog;
  dlcResources: DlcResourceManager;
  operations: PackageOperationCoordinator;
  runtimeContexts: Pick<RuntimeContextRegistry, "get">;
}

export const createPackageManager = Effect.fn(function* ({
  appsDirectory,
  distPath,
  config,
  permissionRegistry,
  filesystemManager,
  registry,
  catalog,
  dlcResources,
  operations,
  runtimeContexts,
}: PackageManagerDependencies) {
  const prebuiltPackagesDirectory = path.join(distPath, "apps", "prebuilt");
  const changingHostIds = new Map<string, number>();
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
    permissionRegistry,
    manifests,
  });
  const initialize = Effect.fn(function* () {
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
      `PackageManager initialized. Found ${prebuiltAppCount} built-in apps, ${prebuiltDlcCount} built-in DLCs, ${installedAppCount} installed apps, and ${installedDlcCount} installed DLCs.`,
    );
  });
  const getPackageInfo: (
    location: FilesystemLocation,
  ) => Effect.Effect<EdenPackageInfo, Error> = Effect.fn(function* (
    location: FilesystemLocation,
  ) {
    return yield* Effect.catch(
      Effect.gen(function* () {
        return yield* filesystemManager.withVolume(location, (hostPath) =>
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
  ) => Effect.Effect<EdenPackageInfo, Error> = Effect.fn(function* (
    hostPath: string,
  ) {
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
    return changingHostIds.has(appId) ? undefined : catalog.getApp(appId);
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
  const getPackageIcon = Effect.fn(function* (packageId: string) {
    return yield* catalog.getIcon(packageId);
  });
  const getPackageSize = Effect.fn(function* (packageId: string) {
    return yield* catalog.getSize(packageId);
  });
  function prepareInstallPackage(
    location: FilesystemLocation,
    replacementConfirmed = false,
  ): OperationTask<InstalledPackageManifest> {
    return filesystemManager.prepareVolumeOperation(
      [location.volume],
      (reporter) => installPackage(location, replacementConfirmed, reporter),
    );
  }
  const installPackage = Effect.fn(function* (
    location: FilesystemLocation,
    replacementConfirmed = false,
    reporter?: OperationReporter,
  ) {
    return yield* filesystemManager.withVolume(location, (hostPath) =>
      installPackageFromHostPath(hostPath, replacementConfirmed, reporter),
    );
  });
  const installPackageFromHostPath = Effect.fn(function* (
    hostPath: string,
    replacementConfirmed = false,
    reporter?: OperationReporter,
  ) {
    const edenitePath = path.resolve(hostPath);
    reporter?.update("reading-archive");
    const info = yield* readPackageInfo(edenitePath);
    const rawManifest = info.manifest;
    yield* Effect.try({
      try: () => assertPackageIdAvailable(rawManifest.id),
      catch: asError,
    });
    return yield* operations.runExclusive(
      () =>
        installPackageExclusive(
          edenitePath,
          rawManifest,
          replacementConfirmed,
          reporter,
        ),
      reporter,
    );
  });
  const installPackageExclusive = Effect.fn(function* (
    edenitePath: string,
    rawManifest: PackageManifest,
    replacementConfirmed: boolean,
    reporter?: OperationReporter,
  ) {
    if (rawManifest.kind === "dlc") {
      if (catalog.hasApp(rawManifest.id)) {
        return yield* Effect.fail(
          new Error(`Package ID ${rawManifest.id} is already used by an app`),
        );
      }
      const host = catalog.getApp(rawManifest.hostAppId);
      if (!host) {
        return yield* Effect.fail(
          new Error(`Host app ${rawManifest.hostAppId} is not installed`),
        );
      }
      const existing = catalog.getDlc(rawManifest.id);
      return yield* runWithHostsChanging(
        [host.id, ...(existing ? [existing.hostAppId] : [])],
        () =>
          installDlc(
            edenitePath,
            rawManifest,
            host,
            existing,
            replacementConfirmed,
            reporter,
          ),
      );
    }
    if (catalog.hasDlc(rawManifest.id)) {
      return yield* Effect.fail(
        new Error(`Package ID ${rawManifest.id} is already used by a DLC`),
      );
    }
    const existing = catalog.getApp(rawManifest.id);
    return yield* runWithHostsChanging([rawManifest.id], () =>
      installApp(
        edenitePath,
        rawManifest,
        existing,
        replacementConfirmed,
        reporter,
      ),
    );
  });
  const installApp = Effect.fn(function* (
    edenitePath: string,
    rawManifest: AppManifest,
    existing: RuntimeAppManifest | undefined,
    replacementConfirmed: boolean,
    reporter?: OperationReporter,
  ) {
    if (existing) {
      if (existing.isPrebuilt || existing.isDevelopment) {
        return yield* Effect.fail(
          new Error(
            `Cannot replace ${existing.id}: it is prebuilt or mounted for development`,
          ),
        );
      }
      yield* Effect.try({
        try: () => assertHostStopped(existing.id),
        catch: asError,
      });
      if (!replacementConfirmed) {
        return yield* Effect.fail(
          new Error(
            replacementRequiredMessage(existing.version, rawManifest.version),
          ),
        );
      }
    }
    const incompatibleDlcs = getIncompatibleDlcs(rawManifest);
    const protectedDlc = incompatibleDlcs.find((dlc) => dlc.isPrebuilt);
    if (protectedDlc) {
      return yield* Effect.fail(
        new Error(
          `Cannot replace ${rawManifest.id}: bundled DLC ${protectedDlc.id} would become incompatible`,
        ),
      );
    }
    const targetPath = path.join(appsDirectory, rawManifest.id);
    yield* operations.execute(
      [
        {
          target: targetPath,
          prepare: Effect.fn(function* (stage) {
            reporter?.update("extracting-archive");
            const result = yield* fromPromise(() =>
              genesisBundler.extract({
                edenitePath,
                outputDirectory: stage,
                verifyChecksum: true,
              }),
            );
            if (!result.success || result.manifest?.kind === "dlc") {
              return yield* Effect.fail(
                new Error(result.error || "Failed to extract app package"),
              );
            }
          }),
        },
        ...incompatibleDlcs.map((dlc) => ({
          target: path.join(catalog.dlcDirectory, dlc.id),
        })),
      ],
      reporter,
    );
    reporter?.update("registering-package");
    for (const dlc of incompatibleDlcs) unregisterDlc(dlc);
    const runtimeManifest = manifests.app(rawManifest, false);
    registry.register(runtimeManifest);
    permissionRegistry.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );
    installed.emit({ manifest: runtimeManifest });
    return runtimeManifest;
  });
  const uninstallPackage = Effect.fn(function* (
    packageId: string,
    reporter?: OperationReporter,
  ) {
    return yield* operations.runExclusive(
      () => uninstallPackageExclusive(packageId, reporter),
      reporter,
    );
  });
  const uninstallPackageExclusive = Effect.fn(function* (
    packageId: string,
    reporter?: OperationReporter,
  ) {
    const dlc = catalog.getDlc(packageId);
    if (dlc) {
      return yield* runWithHostsChanging([dlc.hostAppId], () =>
        uninstallDlc(dlc, reporter),
      );
    }
    const manifest = catalog.getApp(packageId);
    if (!manifest) {
      return false;
    }
    return yield* runWithHostsChanging([manifest.id], () =>
      uninstallApp(manifest, reporter),
    );
  });
  const uninstallApp = Effect.fn(function* (
    manifest: RuntimeAppManifest,
    reporter?: OperationReporter,
  ) {
    if (manifest.isPrebuilt || manifest.isDevelopment) {
      return yield* Effect.fail(
        new Error(`Cannot uninstall ${manifest.id}: this is a system app.`),
      );
    }
    yield* Effect.try({
      try: () => assertHostStopped(manifest.id),
      catch: asError,
    });
    const dlcs = catalog.dlcsForHost(manifest.id);
    const protectedDlc = dlcs.find((dlc) => dlc.isPrebuilt);
    if (protectedDlc) {
      return yield* Effect.fail(
        new Error(
          `Cannot uninstall ${manifest.id}: it owns bundled DLC ${protectedDlc.id}`,
        ),
      );
    }
    yield* operations.execute(
      [
        { target: path.join(appsDirectory, manifest.id) },
        ...dlcs.map((dlc) => ({
          target: path.join(catalog.dlcDirectory, dlc.id),
        })),
      ],
      reporter,
    );
    reporter?.update("unregistering-package");
    for (const dlc of dlcs) unregisterDlc(dlc);
    registry.unregister(manifest.id);
    permissionRegistry.unregisterApp(manifest.id);
    uninstalled.emit({ kind: "app", packageId: manifest.id });
    return true;
  });
  const reloadPackage = Effect.fn(function* (packageId: string) {
    const manifest = yield* Effect.try({
      try: () => requireInstalledApp(packageId),
      catch: asError,
    });
    // Reload the manifest from disk
    const appPath = catalog.getPath(packageId);
    if (!appPath) {
      return yield* Effect.fail(
        new Error(`App path not found for ${packageId}`),
      );
    }
    const manifestPath = path.join(appPath, "manifest.json");
    const manifestContent = yield* fromPromise(() =>
      fs.readFile(manifestPath, "utf-8"),
    );
    const validation = genesisBundler.validatePackageManifestObject(
      yield* Effect.try({
        try: () => JSON.parse(manifestContent),
        catch: asError,
      }),
    );
    if (
      !validation.valid ||
      !validation.manifest ||
      validation.manifest.kind === "dlc"
    ) {
      return yield* Effect.fail(
        new Error(
          `Invalid development manifest: ${validation.errors.join("; ")}`,
        ),
      );
    }
    const rawManifest = yield* manifests.applyHotReloadEntry(
      validation.manifest,
    );
    if (rawManifest.id !== packageId) {
      return yield* Effect.fail(
        new Error(
          `App ID changed from ${packageId} to ${rawManifest.id}; restart the development host`,
        ),
      );
    }
    const incompatibleDlcs = getIncompatibleDlcs(rawManifest);
    if (incompatibleDlcs.length > 0) {
      return yield* Effect.fail(
        new Error(
          `Development reload would invalidate DLCs: ${incompatibleDlcs.map((dlc) => dlc.id).join(", ")}`,
        ),
      );
    }
    // Convert to runtime manifest, preserving prebuilt status
    const runtimeManifest = manifests.app(
      rawManifest,
      manifest.isPrebuilt,
      manifest.isDevelopment,
    );
    // Update in-memory manifest without losing the mounted development path.
    registry.register(
      runtimeManifest,
      manifest.isDevelopment ? { sourcePath: appPath } : undefined,
    );
    permissionRegistry.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );
    // Notify about the reload (ProcessManager should handle restarting)
    installed.emit({ manifest: runtimeManifest });
  });
  const installDlc = Effect.fn(function* (
    edenitePath: string,
    manifest: DlcManifest,
    host: RuntimeAppManifest,
    existing: RuntimeDlcManifest | undefined,
    replacementConfirmed = false,
    reporter?: OperationReporter,
  ) {
    const compatibility = genesisBundler.isDlcCompatible(host, manifest);
    if (!compatibility.compatible) {
      return yield* Effect.fail(
        new Error(
          `DLC is incompatible with its host: ${compatibility.errors.join("; ")}`,
        ),
      );
    }
    yield* Effect.try({
      try: () => assertHostStopped(host.id),
      catch: asError,
    });
    if (existing?.isPrebuilt) {
      return yield* Effect.fail(
        new Error(`Cannot replace ${manifest.id}: it is a bundled DLC`),
      );
    }
    if (existing)
      yield* Effect.try({
        try: () => assertHostStopped(existing.hostAppId),
        catch: asError,
      });
    if (existing && !replacementConfirmed) {
      return yield* Effect.fail(
        new Error(
          replacementRequiredMessage(existing.version, manifest.version),
        ),
      );
    }
    const target = path.join(catalog.dlcDirectory, manifest.id);
    yield* operations.execute(
      [
        {
          target,
          prepare: Effect.fn(function* (stage) {
            reporter?.update("extracting-archive");
            const result = yield* fromPromise(() =>
              genesisBundler.extract({
                edenitePath,
                outputDirectory: stage,
                verifyChecksum: true,
              }),
            );
            if (!result.success || result.manifest?.kind !== "dlc") {
              return yield* Effect.fail(
                new Error(result.error || "Failed to extract DLC package"),
              );
            }
          }),
        },
      ],
      reporter,
    );
    reporter?.update("registering-package");
    const runtimeManifest = manifests.dlc(manifest);
    registry.register(runtimeManifest);
    installed.emit({ manifest: runtimeManifest });
    return runtimeManifest;
  });
  const uninstallDlc = Effect.fn(function* (
    manifest: RuntimeDlcManifest,
    reporter?: OperationReporter,
  ) {
    if (manifest.isPrebuilt) {
      return yield* Effect.fail(
        new Error(`Cannot uninstall ${manifest.id}: it is a bundled DLC`),
      );
    }
    yield* Effect.try({
      try: () => assertHostStopped(manifest.hostAppId),
      catch: asError,
    });
    yield* operations.execute(
      [{ target: path.join(catalog.dlcDirectory, manifest.id) }],
      reporter,
    );
    reporter?.update("unregistering-package");
    unregisterDlc(manifest);
    return true;
  });
  function unregisterDlc(manifest: RuntimeDlcManifest): void {
    registry.unregister(manifest.id);
    uninstalled.emit({
      kind: "dlc" as const,
      packageId: manifest.id,
      hostAppId: manifest.hostAppId,
    });
  }
  function getIncompatibleDlcs(host: AppManifest): RuntimeDlcManifest[] {
    return catalog
      .dlcsForHost(host.id)
      .filter((dlc) => !genesisBundler.isDlcCompatible(host, dlc).compatible);
  }
  function assertHostStopped(appId: string): void {
    if (runtimeContexts.get(appId)) {
      throw new Error(
        `Host app ${appId} must be stopped before changing packages`,
      );
    }
  }
  const runWithHostsChanging = Effect.fn(function* <T, E>(
    appIds: Iterable<string>,
    operation: () => Effect.Effect<T, E>,
  ) {
    const ids = [...new Set(appIds)];
    for (const appId of ids) {
      changingHostIds.set(appId, (changingHostIds.get(appId) ?? 0) + 1);
    }
    return yield* Effect.ensuring(
      Effect.gen(function* () {
        return yield* operation();
      }),
      Effect.sync(() => {
        for (const appId of ids) {
          const depth = changingHostIds.get(appId);
          if (depth === undefined || depth <= 1) {
            changingHostIds.delete(appId);
          } else {
            changingHostIds.set(appId, depth - 1);
          }
        }
      }),
    );
  });
  function replacementRequiredMessage(from: string, to: string): string {
    const operation = from === to ? "reinstall" : "replacement";
    return `Explicit ${operation} confirmation is required (${from} → ${to})`;
  }
  function assertPackageIdAvailable(packageId: string): void {
    if (packageId.startsWith(".") || RESERVED_PACKAGE_IDS.has(packageId)) {
      throw new Error(
        `Package ID "${packageId}" is reserved for Eden system use`,
      );
    }
  }
  const readPackageInfo = Effect.fn(function* (edenitePath: string) {
    yield* fromPromise(() => fs.access(edenitePath)).pipe(
      Effect.mapError(() => new Error(`File not found: ${edenitePath}`)),
    );
    if (!edenitePath.endsWith(".edenite")) {
      return yield* Effect.fail(
        new Error("Invalid file format. Please select a .edenite file"),
      );
    }
    const info = yield* fromPromise(() => genesisBundler.getInfo(edenitePath));
    if (!info.success || !info.manifest) {
      return yield* Effect.fail(
        new Error(info.error || "Invalid .edenite package"),
      );
    }
    return { manifest: info.manifest };
  });
  const isHotReloadEnabled = Effect.fn(function* (packageId: string) {
    yield* Effect.try({
      try: () => requireInstalledApp(packageId),
      catch: asError,
    });
    return yield* fromPromise(() => readHotReloadEnabled(packageId, config));
  });
  const toggleHotReload = Effect.fn(function* (packageId: string) {
    yield* Effect.try({
      try: () => requireInstalledApp(packageId),
      catch: asError,
    });
    return yield* fromPromise(() => updateHotReload(packageId, config));
  });
  function requireInstalledApp(packageId: string): RuntimeAppManifest {
    const manifest = getInstalledPackage(packageId);
    if (!manifest || manifest.kind === "dlc") {
      throw new Error(`Package ${packageId} is not an installed app`);
    }
    return manifest;
  }
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
});
export type PackageManager = Effect.Success<
  ReturnType<typeof createPackageManager>
>;

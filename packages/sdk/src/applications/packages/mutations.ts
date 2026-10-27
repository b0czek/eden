import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type {
  AppManifest,
  DlcManifest,
  PackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { fromPromise } from "../../core/effects/io";
import type { Event } from "../../core/events/event";
import type { OperationReporter } from "../../core/operations/task";
import { io } from "../../platform/filesystem/native-io";
import type { PackageCatalog } from "./catalog";
import { PackageArchiveError, PackageRejected } from "./errors";
import type { InstalledPackages } from "./installed";
import type { PackageManifests } from "./manifests";
import type { PackagePermissions, PackageRuntimeContexts } from "./ports";
import type { PackageTransactions } from "./transactions";
import type { PackageEvents } from "./types";

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

export function createPackageMutations({
  appsDirectory,
  catalog,
  registry,
  permissions,
  runtimeContexts,
  manifests,
  packageTransactions,
  installed,
  uninstalled,
}: {
  appsDirectory: string;
  catalog: PackageCatalog;
  registry: InstalledPackages;
  permissions: PackagePermissions;
  runtimeContexts: PackageRuntimeContexts;
  manifests: PackageManifests;
  packageTransactions: PackageTransactions;
  installed: Event<PackageEvents["installed"]>;
  uninstalled: Event<PackageEvents["uninstalled"]>;
}) {
  const changingHostIds = new Set<string>();
  const installPackageFromHostPath = Effect.fn(function* (
    hostPath: string,
    replacementConfirmed: boolean = false,
    reporter?: OperationReporter,
  ) {
    const edenitePath = path.resolve(hostPath);
    reporter?.update("reading-archive");
    const info = yield* readPackageInfo(edenitePath);
    const rawManifest = info.manifest;
    yield* assertPackageIdAvailable(rawManifest.id);
    return yield* packageTransactions.runExclusive(
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
          new PackageRejected({
            reason: "package-id",
            packageId: rawManifest.id,
            message: `Package ID ${rawManifest.id} is already used by an app`,
          }),
        );
      }
      const host = catalog.getApp(rawManifest.hostAppId);
      if (!host) {
        return yield* Effect.fail(
          new PackageRejected({
            reason: "missing-host",
            message: `Host app ${rawManifest.hostAppId} is not installed`,
          }),
        );
      }
      const existing = catalog.getDlc(rawManifest.id);
      return yield* runWithHostsChanging(
        [host.id, ...(existing ? [existing.hostAppId] : [])],
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
        new PackageRejected({
          reason: "package-id",
          packageId: rawManifest.id,
          message: `Package ID ${rawManifest.id} is already used by a DLC`,
        }),
      );
    }
    const existing = catalog.getApp(rawManifest.id);
    return yield* runWithHostsChanging(
      [rawManifest.id],
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
          new PackageRejected({
            reason: "protected-package",
            packageId: existing.id,
            message: `Cannot replace ${existing.id}: it is prebuilt or mounted for development`,
          }),
        );
      }
      yield* assertHostStopped(existing.id);
      if (!replacementConfirmed) {
        return yield* Effect.fail(
          new PackageRejected({
            reason: "replacement-required",
            message: replacementRequiredMessage(
              existing.version,
              rawManifest.version,
            ),
          }),
        );
      }
    }
    const incompatibleDlcs = getIncompatibleDlcs(rawManifest);
    const protectedDlc = incompatibleDlcs.find((dlc) => dlc.isPrebuilt);
    if (protectedDlc) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "protected-package",
          packageId: rawManifest.id,
          message: `Cannot replace ${rawManifest.id}: bundled DLC ${protectedDlc.id} would become incompatible`,
        }),
      );
    }
    const targetPath = path.join(appsDirectory, rawManifest.id);
    yield* packageTransactions.execute(
      [
        {
          target: targetPath,
          prepare: Effect.fn(function* (stage) {
            reporter?.update("extracting-archive");
            const result = yield* archiveIo(edenitePath, "extract", () =>
              genesisBundler.extract({
                edenitePath,
                outputDirectory: stage,
                verifyChecksum: true,
              }),
            );
            if (!result.success || result.manifest?.kind === "dlc") {
              return yield* Effect.fail(
                new PackageRejected({
                  reason: "incompatible",
                  message: result.error || "Failed to extract app package",
                }),
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
    permissions.registerApp(
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
    return yield* packageTransactions.runExclusive(
      uninstallPackageExclusive(packageId, reporter),
      reporter,
    );
  });
  const uninstallPackageExclusive = Effect.fn(function* (
    packageId: string,
    reporter?: OperationReporter,
  ) {
    const dlc = catalog.getDlc(packageId);
    if (dlc) {
      return yield* runWithHostsChanging(
        [dlc.hostAppId],
        uninstallDlc(dlc, reporter),
      );
    }
    const manifest = catalog.getApp(packageId);
    if (!manifest) {
      return false;
    }
    return yield* runWithHostsChanging(
      [manifest.id],
      uninstallApp(manifest, reporter),
    );
  });
  const uninstallApp = Effect.fn(function* (
    manifest: RuntimeAppManifest,
    reporter?: OperationReporter,
  ) {
    if (manifest.isPrebuilt || manifest.isDevelopment) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "protected-package",
          packageId: manifest.id,
          message: `Cannot uninstall ${manifest.id}: this is a system app.`,
        }),
      );
    }
    yield* assertHostStopped(manifest.id);
    const dlcs = catalog.dlcsForHost(manifest.id);
    const protectedDlc = dlcs.find((dlc) => dlc.isPrebuilt);
    if (protectedDlc) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "protected-package",
          packageId: manifest.id,
          message: `Cannot uninstall ${manifest.id}: it owns bundled DLC ${protectedDlc.id}`,
        }),
      );
    }
    yield* packageTransactions.execute(
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
    permissions.unregisterApp(manifest.id);
    uninstalled.emit({ kind: "app", packageId: manifest.id });
    return true;
  });
  const installDlc = Effect.fn(function* (
    edenitePath: string,
    manifest: DlcManifest,
    host: RuntimeAppManifest,
    existing: RuntimeDlcManifest | undefined,
    replacementConfirmed: boolean = false,
    reporter?: OperationReporter,
  ) {
    const compatibility = genesisBundler.isDlcCompatible(host, manifest);
    if (!compatibility.compatible) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "incompatible",
          message: `DLC is incompatible with its host: ${compatibility.errors.join("; ")}`,
        }),
      );
    }
    yield* assertHostStopped(host.id);
    if (existing?.isPrebuilt) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "protected-package",
          packageId: manifest.id,
          message: `Cannot replace ${manifest.id}: it is a bundled DLC`,
        }),
      );
    }
    if (existing) yield* assertHostStopped(existing.hostAppId);
    if (existing && !replacementConfirmed) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "replacement-required",
          message: replacementRequiredMessage(
            existing.version,
            manifest.version,
          ),
        }),
      );
    }
    const target = path.join(catalog.dlcDirectory, manifest.id);
    yield* packageTransactions.execute(
      [
        {
          target,
          prepare: Effect.fn(function* (stage) {
            reporter?.update("extracting-archive");
            const result = yield* archiveIo(edenitePath, "extract", () =>
              genesisBundler.extract({
                edenitePath,
                outputDirectory: stage,
                verifyChecksum: true,
              }),
            );
            if (!result.success || result.manifest?.kind !== "dlc") {
              return yield* Effect.fail(
                new PackageRejected({
                  reason: "invalid-archive",
                  message: result.error || "Failed to extract DLC package",
                }),
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
        new PackageRejected({
          reason: "protected-package",
          packageId: manifest.id,
          message: `Cannot uninstall ${manifest.id}: it is a bundled DLC`,
        }),
      );
    }
    yield* assertHostStopped(manifest.hostAppId);
    yield* packageTransactions.execute(
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
  function assertHostStopped(appId: string) {
    if (runtimeContexts.get(appId)) {
      return Effect.fail(
        new PackageRejected({
          reason: "host-running",
          packageId: appId,
          message: `Host app ${appId} must be stopped before changing packages`,
        }),
      );
    }
    return Effect.void;
  }
  const runWithHostsChanging = Effect.fn(function* <T, E, R>(
    appIds: Iterable<string>,
    operation: Effect.Effect<T, E, R>,
  ) {
    const ids = [...new Set(appIds)];
    // Install and uninstall hold the exclusive package mutation lock.
    for (const appId of ids) changingHostIds.add(appId);
    return yield* Effect.ensuring(
      operation,
      Effect.sync(() => {
        for (const appId of ids) changingHostIds.delete(appId);
      }),
    );
  });
  function replacementRequiredMessage(from: string, to: string): string {
    const operation = from === to ? "reinstall" : "replacement";
    return `Explicit ${operation} confirmation is required (${from} → ${to})`;
  }
  function assertPackageIdAvailable(packageId: string) {
    if (packageId.startsWith(".") || RESERVED_PACKAGE_IDS.has(packageId)) {
      return Effect.fail(
        new PackageRejected({
          reason: "package-id",
          packageId: packageId,
          message: `Package ID "${packageId}" is reserved for Eden system use`,
        }),
      );
    }
    return Effect.void;
  }
  const readPackageInfo = Effect.fn(function* (edenitePath: string) {
    yield* io.access(edenitePath);
    if (!edenitePath.endsWith(".edenite")) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "invalid-archive",
          message: "Invalid file format. Please select a .edenite file",
        }),
      );
    }
    const info = yield* archiveIo(edenitePath, "inspect", () =>
      genesisBundler.getInfo(edenitePath),
    );
    if (!info.success || !info.manifest) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "invalid-archive",
          message: info.error || "Invalid .edenite package",
        }),
      );
    }
    return { manifest: info.manifest };
  });

  return {
    installPackageFromHostPath,
    uninstallPackage,
    getIncompatibleDlcs,
    isHostChanging: (appId: string) => changingHostIds.has(appId),
  };
}

function archiveIo<A>(
  archivePath: string,
  operation: "read" | "inspect" | "extract",
  evaluate: () => Promise<A>,
) {
  return fromPromise(
    evaluate,
    (cause) =>
      new PackageArchiveError({
        path: archivePath,
        operation,
        cause,
        message: `Failed to ${operation} package archive: ${archivePath}`,
      }),
  );
}

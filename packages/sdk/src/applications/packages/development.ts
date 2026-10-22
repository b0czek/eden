import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type {
  AppManifest,
  EdenConfig,
  RuntimeDlcManifest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { asError } from "../../core/effects/io";
import type { Event } from "../../core/events/event";
import {
  isHotReloadEnabled as readHotReloadEnabled,
  toggleHotReload as updateHotReload,
} from "../../hotreload-config";
import { FilesystemIoFailed } from "../../platform/filesystem/native-errors";
import { io } from "../../platform/filesystem/native-io";
import type { PackageCatalog } from "./catalog";
import { PackageDevelopmentError, PackageRejected } from "./errors";
import type { InstalledPackages } from "./installed";
import type { PackageManifests } from "./manifests";
import type { PackagePermissions } from "./ports";
import type { PackageEvents } from "./types";

export function createPackageDevelopment({
  config,
  catalog,
  registry,
  permissions,
  manifests,
  installed,
  getIncompatibleDlcs,
}: {
  config: EdenConfig;
  catalog: PackageCatalog;
  registry: InstalledPackages;
  permissions: PackagePermissions;
  manifests: PackageManifests;
  installed: Event<PackageEvents["installed"]>;
  getIncompatibleDlcs: (host: AppManifest) => RuntimeDlcManifest[];
}) {
  const reloadPackage = Effect.fn(function* (packageId: string) {
    const manifest = yield* requireInstalledApp(packageId);
    // Reload the manifest from disk
    const appPath = catalog.getPath(packageId);
    if (!appPath) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "missing-path",
          packageId,
          message: `App path not found for ${packageId}`,
        }),
      );
    }
    const manifestPath = path.join(appPath, "manifest.json");
    const manifestContent = yield* io.readFile(manifestPath, "utf-8");
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
        new PackageRejected({
          reason: "invalid-manifest",
          packageId,
          message: `Invalid development manifest: ${validation.errors.join("; ")}`,
        }),
      );
    }
    const rawManifest = yield* manifests.applyHotReloadEntry(
      validation.manifest,
    );
    if (rawManifest.id !== packageId) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "package-id",
          packageId,
          message: `App ID changed from ${packageId} to ${rawManifest.id}; restart the development host`,
        }),
      );
    }
    const incompatibleDlcs = getIncompatibleDlcs(rawManifest);
    if (incompatibleDlcs.length > 0) {
      return yield* Effect.fail(
        new PackageRejected({
          reason: "incompatible",
          packageId,
          message: `Development reload would invalidate DLCs: ${incompatibleDlcs.map((dlc) => dlc.id).join(", ")}`,
        }),
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
    permissions.registerApp(
      runtimeManifest.id,
      runtimeManifest.permissions,
      runtimeManifest.resolvedGrants,
    );
    // Notify about the reload (Processes should handle restarting)
    installed.emit({ manifest: runtimeManifest });
  });
  const isHotReloadEnabled = Effect.fn(function* (packageId: string) {
    yield* requireInstalledApp(packageId);
    return yield* readHotReloadEnabled(packageId, config);
  });
  const toggleHotReload = Effect.fn(function* (packageId: string) {
    yield* requireInstalledApp(packageId);
    return yield* updateHotReload(packageId, config);
  });
  function requireInstalledApp(packageId: string) {
    const manifest = catalog.get(packageId);
    if (!manifest || manifest.kind === "dlc") {
      return Effect.fail(
        new PackageRejected({
          reason: "not-installed",
          packageId,
          message: `Package ${packageId} is not an installed app`,
        }),
      );
    }
    return Effect.succeed(manifest);
  }
  return {
    reloadPackage: (packageId: string) =>
      reloadPackage(packageId).pipe(
        Effect.mapError((cause) =>
          cause instanceof PackageRejected ||
          cause instanceof FilesystemIoFailed
            ? cause
            : new PackageDevelopmentError({
                packageId,
                operation: "reload",
                message: cause.message,
                cause,
              }),
        ),
      ),
    isHotReloadEnabled,
    toggleHotReload,
  };
}

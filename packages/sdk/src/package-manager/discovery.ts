import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as genesisBundler from "@edenapp/genesis";
import type { DlcManifest, EdenConfig, PackageManifest } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { asError, fromPromise } from "../effects/io";
import { loadHotReloadAppsState } from "../hotreload-config";
import type { PermissionRegistry } from "../ipc/PermissionRegistry";
import { log } from "../logging";
import type { PackageManifests } from "./manifests";
import type { PackageCatalog } from "./PackageCatalog";
import type { PackageRegistry } from "./PackageRegistry";
export function createPackageDiscovery({
  appsDirectory,
  prebuiltPackagesDirectory,
  config,
  registry,
  catalog,
  permissionRegistry,
  manifests,
}: {
  appsDirectory: string;
  prebuiltPackagesDirectory: string;
  config: EdenConfig;
  registry: PackageRegistry;
  catalog: PackageCatalog;
  permissionRegistry: Pick<PermissionRegistry, "registerApp">;
  manifests: PackageManifests;
}) {
  const loadDevelopmentApps = Effect.fn(function* (
    prebuiltDlcIds: ReadonlySet<string>,
  ) {
    const state = yield* fromPromise(() => loadHotReloadAppsState(config));
    for (const entry of state.apps) {
      yield* Effect.catch(
        Effect.gen(function* () {
          const sourcePath = path.resolve(entry.sourcePath);
          const manifestContents = yield* fromPromise(() =>
            fs.readFile(path.join(sourcePath, "manifest.json"), "utf-8"),
          );
          const parsed = (yield* Effect.try({
            try: () => JSON.parse(manifestContents),
            catch: asError,
          })) as PackageManifest;
          const validation =
            genesisBundler.validatePackageManifestObject(parsed);
          if (
            !validation.valid ||
            !validation.manifest ||
            validation.manifest.kind === "dlc"
          ) {
            return yield* Effect.fail(
              new Error(
                `Invalid development app manifest: ${validation.errors.join("; ")}`,
              ),
            );
          }
          const rawManifest = yield* manifests.applyHotReloadEntry(
            validation.manifest,
          );
          if (rawManifest.id !== entry.id) {
            return yield* Effect.fail(
              new Error(
                `apps.json id ${entry.id} does not match ${rawManifest.id}`,
              ),
            );
          }
          if (prebuiltDlcIds.has(rawManifest.id)) {
            return yield* Effect.fail(
              new Error(
                `Development app ID ${rawManifest.id} is reserved by a built-in DLC`,
              ),
            );
          }
          const runtimeManifest = manifests.app(rawManifest, false, true);
          registry.register(runtimeManifest, { sourcePath });
          permissionRegistry.registerApp(
            runtimeManifest.id,
            runtimeManifest.permissions,
            runtimeManifest.resolvedGrants,
          );
          log.info(`Mounted development app: ${entry.id} (${sourcePath})`);
        }),
        (error) =>
          Effect.sync(() => {
            log.warn(`Failed to mount development app ${entry.id}:`, error);
          }),
      );
    }
  });
  const loadPrebuiltPackages = Effect.fn(function* () {
    const dlcs: DlcManifest[] = [];
    const packageIds = new Set<string>();
    yield* Effect.catch(
      Effect.gen(function* () {
        const directoryExists = yield* fromPromise(() =>
          fs.access(prebuiltPackagesDirectory),
        ).pipe(
          Effect.map(() => true),
          Effect.catch(() => Effect.succeed(false)),
        );
        if (!directoryExists) {
          log.info("No built-in package directory found, skipping...");
          return;
        }
        const entries = yield* fromPromise(() =>
          fs.readdir(prebuiltPackagesDirectory, {
            withFileTypes: true,
          }),
        );
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            yield* Effect.catch(
              Effect.gen(function* () {
                const manifestPath = path.join(
                  prebuiltPackagesDirectory,
                  entry.name,
                  "manifest.json",
                );
                const manifestContent = yield* fromPromise(() =>
                  fs.readFile(manifestPath, "utf-8"),
                );
                const parsed = (yield* Effect.try({
                  try: () => JSON.parse(manifestContent),
                  catch: asError,
                })) as PackageManifest;
                const validation =
                  genesisBundler.validatePackageManifestObject(parsed);
                if (!validation.valid || !validation.manifest) {
                  return yield* Effect.fail(
                    new Error(
                      `Invalid package manifest: ${validation.errors.join("; ")}`,
                    ),
                  );
                }
                if (packageIds.has(validation.manifest.id)) {
                  return yield* Effect.fail(
                    new Error(`Duplicate package ID ${validation.manifest.id}`),
                  );
                }
                packageIds.add(validation.manifest.id);
                if (validation.manifest.kind === "dlc") {
                  dlcs.push(validation.manifest);
                  return;
                }
                const rawManifest = yield* manifests.applyHotReloadEntry(
                  validation.manifest,
                );
                log.info(
                  `Loaded built-in app: ${rawManifest.id}${
                    rawManifest.frontend?.entry.startsWith("http")
                      ? ` (hot reload: ${rawManifest.frontend.entry})`
                      : ""
                  }`,
                );
                const runtimeManifest = manifests.app(rawManifest, true);
                registry.register(runtimeManifest);
                // Register app permissions
                permissionRegistry.registerApp(
                  runtimeManifest.id,
                  runtimeManifest.permissions,
                  runtimeManifest.resolvedGrants,
                );
              }),
              (error) =>
                Effect.sync(() => {
                  log.warn(
                    `Failed to load built-in package from ${entry.name}:`,
                    error,
                  );
                }),
            );
          }
        }
      }),
      (error) =>
        Effect.sync(() => {
          log.error("Failed to load built-in packages:", error);
        }),
    );
    return dlcs;
  });
  const loadPrebuiltDlcs = Effect.fn(function* (dlcs: DlcManifest[]) {
    for (const rawManifest of dlcs) {
      yield* Effect.catch(
        Effect.gen(function* () {
          if (catalog.has(rawManifest.id)) {
            return yield* Effect.fail(
              new Error(`Duplicate package ID ${rawManifest.id}`),
            );
          }
          const host = catalog.getApp(rawManifest.hostAppId);
          if (!host) {
            return yield* Effect.fail(
              new Error(`Host app ${rawManifest.hostAppId} is not installed`),
            );
          }
          const compatibility = genesisBundler.isDlcCompatible(
            host,
            rawManifest,
          );
          if (!compatibility.compatible) {
            return yield* Effect.fail(
              new Error(compatibility.errors.join("; ")),
            );
          }
          const manifest = manifests.dlc(rawManifest, true);
          registry.register(manifest);
          log.info(`Loaded built-in DLC: ${manifest.id}`);
        }),
        (error) =>
          Effect.sync(() => {
            log.warn(`Failed to load built-in DLC ${rawManifest.id}:`, error);
          }),
      );
    }
  });
  const loadInstalledDlcs = Effect.fn(function* (
    prebuiltDlcIds: ReadonlySet<string>,
  ) {
    const entries = yield* fromPromise(() =>
      fs.readdir(catalog.dlcDirectory, {
        withFileTypes: true,
      }),
    );
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      yield* Effect.catch(
        Effect.gen(function* () {
          const manifestContents = yield* fromPromise(() =>
            fs.readFile(
              path.join(catalog.dlcDirectory, entry.name, "manifest.json"),
              "utf-8",
            ),
          );
          const parsed = (yield* Effect.try({
            try: () => JSON.parse(manifestContents),
            catch: asError,
          })) as PackageManifest;
          const validation =
            genesisBundler.validatePackageManifestObject(parsed);
          if (!validation.valid || validation.manifest?.kind !== "dlc") {
            return yield* Effect.fail(
              new Error(
                `Invalid DLC manifest: ${validation.errors.join("; ")}`,
              ),
            );
          }
          const manifest = manifests.dlc(validation.manifest);
          if (prebuiltDlcIds.has(manifest.id)) {
            return yield* Effect.fail(
              new Error(
                `Package ID ${manifest.id} is reserved by a built-in DLC`,
              ),
            );
          }
          if (catalog.has(manifest.id)) {
            return yield* Effect.fail(
              new Error(`Duplicate package ID ${manifest.id}`),
            );
          }
          const host = catalog.getApp(manifest.hostAppId);
          if (!host)
            return yield* Effect.fail(
              new Error(`Host app ${manifest.hostAppId} is not installed`),
            );
          const compatibility = genesisBundler.isDlcCompatible(host, manifest);
          if (!compatibility.compatible)
            return yield* Effect.fail(
              new Error(compatibility.errors.join("; ")),
            );
          registry.register(manifest);
        }),
        (error) =>
          Effect.sync(() => {
            log.warn(`Failed to load DLC from ${entry.name}:`, error);
          }),
      );
    }
  });
  const loadInstalledApps = Effect.fn(function* (
    prebuiltDlcIds: ReadonlySet<string>,
  ) {
    return yield* Effect.catch(
      Effect.gen(function* () {
        const entries = yield* fromPromise(() =>
          fs.readdir(appsDirectory, {
            withFileTypes: true,
          }),
        );
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith(".")) {
            yield* Effect.catch(
              Effect.gen(function* () {
                const manifestPath = path.join(
                  appsDirectory,
                  entry.name,
                  "manifest.json",
                );
                const manifestContent = yield* fromPromise(() =>
                  fs.readFile(manifestPath, "utf-8"),
                );
                const parsed = (yield* Effect.try({
                  try: () => JSON.parse(manifestContent),
                  catch: asError,
                })) as PackageManifest;
                const validation =
                  genesisBundler.validatePackageManifestObject(parsed);
                if (
                  !validation.valid ||
                  !validation.manifest ||
                  validation.manifest.kind === "dlc"
                ) {
                  return yield* Effect.fail(
                    new Error(
                      `Invalid app manifest: ${validation.errors.join("; ")}`,
                    ),
                  );
                }
                const rawManifest = yield* manifests.applyHotReloadEntry(
                  validation.manifest,
                );
                if (prebuiltDlcIds.has(rawManifest.id)) {
                  return yield* Effect.fail(
                    new Error(
                      `Package ID ${rawManifest.id} is reserved by a built-in DLC`,
                    ),
                  );
                }
                const existing = catalog.get(rawManifest.id);
                if (existing) {
                  return yield* Effect.fail(
                    new Error(
                      existing.isPrebuilt
                        ? `Package ID ${rawManifest.id} is reserved by a built-in package`
                        : `Duplicate package ID ${rawManifest.id}`,
                    ),
                  );
                }
                const runtimeManifest = manifests.app(rawManifest, false);
                registry.register(runtimeManifest);
                // Register app permissions
                permissionRegistry.registerApp(
                  runtimeManifest.id,
                  runtimeManifest.permissions,
                  runtimeManifest.resolvedGrants,
                );
              }),
              (error) =>
                Effect.sync(() => {
                  log.warn(`Failed to load app from ${entry.name}:`, error);
                }),
            );
          }
        }
      }),
      (error) =>
        Effect.sync(() => {
          log.error("Failed to load installed apps:", error);
        }),
    );
  });

  return {
    loadDevelopmentApps,
    loadPrebuiltPackages,
    loadPrebuiltDlcs,
    loadInstalledDlcs,
    loadInstalledApps,
  };
}

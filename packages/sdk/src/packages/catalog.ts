import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  InstalledPackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import fg from "fast-glob";
import { fromPromise } from "../effects/io";
import type { ExecutionContext } from "../execution";
import { log } from "../logging";
import { DEFAULT_PACKAGE_ICON_DATA_URL } from "./default-icon";
import type { InstalledPackages } from "./installed";
export interface AppPackageListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
}

export const createPackageCatalog = ({
  registry,
  executionContext,
  appsDirectory,
  distPath,
}: {
  registry: InstalledPackages;
  executionContext: Pick<ExecutionContext, "canLaunchApp">;
  appsDirectory: string;
  distPath: string;
}) => {
  const dlcDirectory = path.join(appsDirectory, ".dlcs");
  function get(packageId: string): InstalledPackageManifest | undefined {
    return registry.get(packageId);
  }
  function has(packageId: string): boolean {
    return get(packageId) !== undefined;
  }
  function all(): InstalledPackageManifest[] {
    return registry.all();
  }
  function getApp(appId: string): RuntimeAppManifest | undefined {
    return registry.getApp(appId);
  }
  function hasApp(appId: string): boolean {
    return getApp(appId) !== undefined;
  }
  function allApps(): RuntimeAppManifest[] {
    return all().filter(
      (manifest): manifest is RuntimeAppManifest => manifest.kind === "app",
    );
  }
  function prebuiltApps(): RuntimeAppManifest[] {
    return allApps().filter((app) => app.isPrebuilt);
  }
  function installedApps(): RuntimeAppManifest[] {
    return allApps().filter((app) => !app.isPrebuilt && !app.isDevelopment);
  }
  function developmentApps(): RuntimeAppManifest[] {
    return allApps().filter((app) => app.isDevelopment);
  }
  function listApps(options: AppPackageListOptions = {}): RuntimeAppManifest[] {
    const { showHidden = false, showRestricted = false } = options;
    return allApps().filter((app) => {
      if (!showHidden) {
        const isHidden = app.hidden !== undefined ? app.hidden : app.overlay;
        if (isHidden || !app.frontend?.entry) return false;
      }
      return showRestricted || executionContext.canLaunchApp(app.id);
    });
  }
  function getLaunchableApp(appId: string): RuntimeAppManifest | undefined {
    const app = getApp(appId);
    return app && executionContext.canLaunchApp(appId) ? app : undefined;
  }
  function getDlc(dlcId: string): RuntimeDlcManifest | undefined {
    return registry.getDlc(dlcId);
  }
  function hasDlc(dlcId: string): boolean {
    return getDlc(dlcId) !== undefined;
  }
  function allDlcs(): RuntimeDlcManifest[] {
    return all().filter(
      (manifest): manifest is RuntimeDlcManifest => manifest.kind === "dlc",
    );
  }
  function dlcsForHost(hostAppId: string): RuntimeDlcManifest[] {
    return allDlcs().filter((manifest) => manifest.hostAppId === hostAppId);
  }
  function getPath(packageId: string): string | undefined {
    const manifest = get(packageId);
    if (!manifest) return undefined;
    if (manifest.kind === "dlc") {
      return manifest.isPrebuilt
        ? path.join(distPath, "apps", "prebuilt", packageId)
        : path.join(dlcDirectory, packageId);
    }
    if (manifest.isDevelopment) return registry.getSourcePath(packageId);
    return manifest.isPrebuilt
      ? path.join(distPath, "apps", "prebuilt", packageId)
      : path.join(appsDirectory, packageId);
  }
  const getIcon = Effect.fn(function* (packageId: string) {
    const manifest = get(packageId);
    const packagePath = getPath(packageId);
    const fallback =
      manifest?.kind === "app" ? DEFAULT_PACKAGE_ICON_DATA_URL : undefined;
    const icon = manifest?.icon;
    if (!icon || !packagePath) return fallback;
    return yield* Effect.gen(function* () {
      const iconPath =
        manifest.kind === "dlc"
          ? yield* resolveContainedDlcPath(packageId, icon)
          : path.join(packagePath, icon);
      const content = yield* fromPromise(() => fs.readFile(iconPath));
      return `data:${imageMimeType(iconPath)};base64,${content.toString("base64")}`;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          log.warn(`Failed to read icon for ${packageId}:`, error);
          return fallback;
        }),
      ),
    );
  });
  const getSize = Effect.fn(function* (packageId: string) {
    const packagePath = getPath(packageId);
    if (!packagePath) return undefined;
    return yield* Effect.catch(
      Effect.gen(function* () {
        const files = yield* fromPromise(() =>
          fg("**/*", {
            cwd: packagePath,
            stats: true,
            followSymbolicLinks: false,
            onlyFiles: true,
          }),
        );
        return files.reduce((sum, file) => sum + (file.stats?.size ?? 0), 0);
      }),
      (error) =>
        Effect.sync(() => {
          log.warn(`Failed to calculate size for ${packageId}:`, error);
          return undefined;
        }),
    );
  });
  const resolveContainedDlcPath = Effect.fn(function* (
    dlcId: string,
    relativePath: string,
  ) {
    const manifest = getDlc(dlcId);
    const root = getPath(dlcId);
    if (!manifest || !root)
      return yield* Effect.fail(new Error(`DLC ${dlcId} is not installed`));
    if (!relativePath || path.isAbsolute(relativePath)) {
      return yield* Effect.fail(new Error("DLC path must be relative"));
    }
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return yield* Effect.fail(new Error("DLC path escapes the package root"));
    }
    const [realRoot, realTarget] = yield* fromPromise(() =>
      Promise.all([fs.realpath(root), fs.realpath(target)]),
    );
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      return yield* Effect.fail(
        new Error("DLC path resolves outside the package root"),
      );
    }
    return realTarget;
  });
  function imageMimeType(filePath: string): string {
    const types: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".svg": "image/svg+xml",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".ico": "image/x-icon",
    };
    return (
      types[path.extname(filePath).toLowerCase()] ?? "application/octet-stream"
    );
  }
  return {
    dlcDirectory,
    get,
    has,
    all,
    getApp,
    hasApp,
    allApps,
    prebuiltApps,
    installedApps,
    developmentApps,
    listApps,
    getLaunchableApp,
    getDlc,
    hasDlc,
    allDlcs,
    dlcsForHost,
    getPath,
    getIcon,
    getSize,
    resolveContainedDlcPath,
  };
};
export type PackageCatalog = ReturnType<typeof createPackageCatalog>;

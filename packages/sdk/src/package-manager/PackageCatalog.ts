import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  InstalledPackageManifest,
  RuntimeAppManifest,
  RuntimeDlcManifest,
} from "@edenapp/types";
import fg from "fast-glob";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { ExecutionContext } from "../execution";
import { log } from "../logging";
import { DEFAULT_PACKAGE_ICON_DATA_URL } from "./defaultPackageIcon";
import { PackageRegistry } from "./PackageRegistry";

export interface AppPackageListOptions {
  showHidden?: boolean;
  showRestricted?: boolean;
}

/** Unified inventory and filesystem metadata for every installed package. */
@scoped(Lifecycle.ContainerScoped)
@injectable()
export class PackageCatalog {
  readonly dlcDirectory: string;

  constructor(
    @inject(PackageRegistry) private readonly registry: PackageRegistry,
    @inject(ExecutionContext)
    private readonly executionContext: ExecutionContext,
    @inject("appsDirectory") private readonly appsDirectory: string,
    @inject("distPath") private readonly distPath: string,
  ) {
    this.dlcDirectory = path.join(appsDirectory, ".dlcs");
  }

  get(packageId: string): InstalledPackageManifest | undefined {
    return this.registry.get(packageId);
  }

  has(packageId: string): boolean {
    return this.get(packageId) !== undefined;
  }

  all(): InstalledPackageManifest[] {
    return this.registry.all();
  }

  getApp(appId: string): RuntimeAppManifest | undefined {
    return this.registry.getApp(appId);
  }

  hasApp(appId: string): boolean {
    return this.getApp(appId) !== undefined;
  }

  allApps(): RuntimeAppManifest[] {
    return this.all().filter(
      (manifest): manifest is RuntimeAppManifest => manifest.kind === "app",
    );
  }

  prebuiltApps(): RuntimeAppManifest[] {
    return this.allApps().filter((app) => app.isPrebuilt);
  }

  installedApps(): RuntimeAppManifest[] {
    return this.allApps().filter(
      (app) => !app.isPrebuilt && !app.isDevelopment,
    );
  }

  developmentApps(): RuntimeAppManifest[] {
    return this.allApps().filter((app) => app.isDevelopment);
  }

  listApps(options: AppPackageListOptions = {}): RuntimeAppManifest[] {
    const { showHidden = false, showRestricted = false } = options;
    return this.allApps().filter((app) => {
      if (!showHidden) {
        const isHidden = app.hidden !== undefined ? app.hidden : app.overlay;
        if (isHidden || !app.frontend?.entry) return false;
      }
      return showRestricted || this.executionContext.canLaunchApp(app.id);
    });
  }

  getLaunchableApp(appId: string): RuntimeAppManifest | undefined {
    const app = this.getApp(appId);
    return app && this.executionContext.canLaunchApp(appId) ? app : undefined;
  }

  getDlc(dlcId: string): RuntimeDlcManifest | undefined {
    return this.registry.getDlc(dlcId);
  }

  hasDlc(dlcId: string): boolean {
    return this.getDlc(dlcId) !== undefined;
  }

  allDlcs(): RuntimeDlcManifest[] {
    return this.all().filter(
      (manifest): manifest is RuntimeDlcManifest => manifest.kind === "dlc",
    );
  }

  dlcsForHost(hostAppId: string): RuntimeDlcManifest[] {
    return this.allDlcs().filter(
      (manifest) => manifest.hostAppId === hostAppId,
    );
  }

  getPath(packageId: string): string | undefined {
    const manifest = this.get(packageId);
    if (!manifest) return undefined;
    if (manifest.kind === "dlc") {
      return manifest.isPrebuilt
        ? path.join(this.distPath, "apps", "prebuilt", packageId)
        : path.join(this.dlcDirectory, packageId);
    }
    if (manifest.isDevelopment) return this.registry.getSourcePath(packageId);
    return manifest.isPrebuilt
      ? path.join(this.distPath, "apps", "prebuilt", packageId)
      : path.join(this.appsDirectory, packageId);
  }

  async getIcon(packageId: string): Promise<string | undefined> {
    const manifest = this.get(packageId);
    const packagePath = this.getPath(packageId);
    if (manifest?.icon && packagePath) {
      try {
        const iconPath =
          manifest.kind === "dlc"
            ? await this.resolveContainedDlcPath(packageId, manifest.icon)
            : path.join(packagePath, manifest.icon);
        const content = await fs.readFile(iconPath);
        return `data:${this.imageMimeType(iconPath)};base64,${content.toString("base64")}`;
      } catch (error) {
        log.warn(`Failed to read icon for ${packageId}:`, error);
      }
    }
    return manifest?.kind === "app" ? DEFAULT_PACKAGE_ICON_DATA_URL : undefined;
  }

  async getSize(packageId: string): Promise<number | undefined> {
    const packagePath = this.getPath(packageId);
    if (!packagePath) return undefined;
    try {
      const files = await fg("**/*", {
        cwd: packagePath,
        stats: true,
        followSymbolicLinks: false,
        onlyFiles: true,
      });
      return files.reduce((sum, file) => sum + (file.stats?.size ?? 0), 0);
    } catch (error) {
      log.warn(`Failed to calculate size for ${packageId}:`, error);
      return undefined;
    }
  }

  async resolveContainedDlcPath(
    dlcId: string,
    relativePath: string,
  ): Promise<string> {
    const manifest = this.getDlc(dlcId);
    const root = this.getPath(dlcId);
    if (!manifest || !root) throw new Error(`DLC ${dlcId} is not installed`);
    if (!relativePath || path.isAbsolute(relativePath)) {
      throw new Error("DLC path must be relative");
    }
    const target = path.resolve(root, relativePath);
    const relative = path.relative(root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("DLC path escapes the package root");
    }
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(root),
      fs.realpath(target),
    ]);
    const realRelative = path.relative(realRoot, realTarget);
    if (realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
      throw new Error("DLC path resolves outside the package root");
    }
    return realTarget;
  }

  private imageMimeType(filePath: string): string {
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
}

import type {
  InstalledPackageInfo,
  InstalledPackageManifest,
  PackageManifest,
  PackageOperationPreview,
  RuntimeAppManifest,
} from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import { log } from "../logging";
import type { PackageManager } from "./PackageManager";
@EdenNamespace("package")
export class PackageHandler {
  private packageManager: PackageManager;

  constructor(packageManager: PackageManager) {
    this.packageManager = packageManager;
  }

  /** Install an application or DLC from a local path. */
  @EdenHandler("install", { permission: "manage" })
  async handleInstallPackage(args: {
    sourcePath: string;
    replace?: boolean;
  }): Promise<InstalledPackageManifest> {
    const { sourcePath } = args;
    log.info(`Installing from path: ${sourcePath}`);
    return await this.packageManager.installPackage(
      sourcePath,
      args.replace === true,
    );
  }

  /**
   * Uninstall an application or DLC by its package ID.
   */
  @EdenHandler("uninstall", { permission: "manage" })
  async handleUninstallPackage(args: { packageId: string }): Promise<boolean> {
    return await this.packageManager.uninstallPackage(args.packageId);
  }

  /**
   * List all installed applications.
   * @param showHidden - If true, includes overlay apps and daemons (hidden by default)
   * @param showRestricted - If true, includes apps the current user cannot launch (hidden by default)
   */
  @EdenHandler("list", { permission: "read" })
  async handleListApps(args: {
    showHidden?: boolean;
    showRestricted?: boolean;
  }): Promise<RuntimeAppManifest[]> {
    return this.packageManager.listInstalledPackages({
      kind: "app",
      showHidden: args.showHidden,
      showRestricted: args.showRestricted,
    });
  }

  /** Identify the authenticated app and return its extension resources. */
  @EdenHandler("self")
  handleSelf(args: {
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): InstalledPackageInfo {
    const appId = this.requireCallerAppId(args._callerAppId);
    const info = this.packageManager.getInstalledPackageInfo(
      appId,
      args._callerWebContentsId,
    );
    if (info?.manifest.kind !== "app") {
      throw new Error(`App ${appId} is not installed`);
    }
    return info;
  }

  /** Get an installed package and any extension resources it owns. */
  @EdenHandler("get", { permission: "read" })
  handleGetPackage(args: {
    packageId: string;
    _callerWebContentsId?: number;
  }): InstalledPackageInfo {
    const info = this.packageManager.getInstalledPackageInfo(
      args.packageId,
      args._callerWebContentsId,
    );
    if (!info) throw new Error(`Package ${args.packageId} is not installed`);
    return info;
  }

  /**
   * Toggle hot reload for an app
   */
  @EdenHandler("toggle-hot-reload", { permission: "manage" })
  async handleToggleHotReload(params: {
    packageId: string;
  }): Promise<{ enabled: boolean }> {
    const enabled = await this.packageManager.toggleHotReload(params.packageId);
    log.info(
      `Hot reload ${enabled ? "enabled" : "disabled"} for ${params.packageId}`,
    );
    return { enabled };
  }

  /**
   * Check if hot reload is enabled for an app
   */
  @EdenHandler("is-hot-reload-enabled", { permission: "read" })
  async handleIsHotReloadEnabled(params: {
    packageId: string;
  }): Promise<{ enabled: boolean }> {
    const enabled = await this.packageManager.isHotReloadEnabled(
      params.packageId,
    );
    return { enabled };
  }

  /**
   * Get the icon for an installed package as a data URL.
   */
  @EdenHandler("get-icon", { permission: "read" })
  async handleGetPackageIcon(args: {
    packageId: string;
  }): Promise<{ icon: string | undefined }> {
    return { icon: await this.packageManager.getPackageIcon(args.packageId) };
  }

  /**
   * Get info about a package file without installing it
   */
  @EdenHandler("get-info", { permission: "read" })
  async handleGetPackageInfo(args: { path: string }): Promise<{
    success: boolean;
    manifest?: PackageManifest;
    preview?: PackageOperationPreview;
    error?: string;
  }> {
    const { path } = args;
    return await this.packageManager.getPackageInfo(path);
  }

  /**
   * Get the installed size of a package in bytes.
   */
  @EdenHandler("get-size", { permission: "read" })
  async handleGetPackageSize(args: {
    packageId: string;
  }): Promise<{ size: number | undefined }> {
    return { size: await this.packageManager.getPackageSize(args.packageId) };
  }

  private requireCallerAppId(appId?: string): string {
    if (!appId) throw new Error("An authenticated app is required");
    return appId;
  }
}

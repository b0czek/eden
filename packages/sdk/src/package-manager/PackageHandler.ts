import { AppManifest } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import { PackageManager } from "./PackageManager";
import { toggleHotReload, isHotReloadEnabled } from "../hotreload-config";

@EdenNamespace("package")
export class PackageHandler {
  private packageManager: PackageManager;

  constructor(packageManager: PackageManager) {
    this.packageManager = packageManager;
  }

  /**
   * Install an application from a local path.
   */
  @EdenHandler("install", { permission: "manage" })
  async handleInstallApp(args: { sourcePath: string }): Promise<AppManifest> {
    const { sourcePath } = args;
    console.log(`[PackageHandler] Installing from path: ${sourcePath}`);
    return await this.packageManager.installApp(sourcePath);
  }

  /**
   * Uninstall an application by its ID.
   */
  @EdenHandler("uninstall", { permission: "manage" })
  async handleUninstallApp(args: { appId: string }): Promise<boolean> {
    const { appId } = args;
    return await this.packageManager.uninstallApp(appId);
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
  }): Promise<AppManifest[]> {
    return this.packageManager.getInstalledApps({
      showHidden: args.showHidden,
      showRestricted: args.showRestricted,
    });
  }

  /**
   * Toggle hot reload for an app
   */
  @EdenHandler("toggle-hot-reload", { permission: "manage" })
  async handleToggleHotReload(params: {
    appId: string;
  }): Promise<{ enabled: boolean }> {
    const enabled = await toggleHotReload(params.appId);
    console.log(
      `Hot reload ${enabled ? "enabled" : "disabled"} for ${params.appId}`
    );
    return { enabled };
  }

  /**
   * Check if hot reload is enabled for an app
   */
  @EdenHandler("is-hot-reload-enabled", { permission: "read" })
  async handleIsHotReloadEnabled(params: {
    appId: string;
  }): Promise<{ enabled: boolean }> {
    const enabled = await isHotReloadEnabled(params.appId);
    return { enabled };
  }

  /**
   * Get the icon for an installed application as a data URL.
   */
  @EdenHandler("get-icon", { permission: "read" })
  async handleGetAppIcon(args: {
    appId: string;
  }): Promise<{ icon: string | undefined }> {
    const { appId } = args;
    const icon = await this.packageManager.getAppIcon(appId);
    return { icon };
  }

  /**
   * Get info about a package file without installing it
   */
  @EdenHandler("get-info", { permission: "read" })
  async handleGetPackageInfo(args: {
    path: string;
  }): Promise<{ success: boolean; manifest?: AppManifest; error?: string }> {
    const { path } = args;
    return await this.packageManager.getPackageInfo(path);
  }

  /**
   * Get the installed size of an app in bytes
   */
  @EdenHandler("get-size", { permission: "read" })
  async handleGetAppSize(args: {
    appId: string;
  }): Promise<{ size: number | undefined }> {
    const { appId } = args;
    const size = await this.packageManager.getAppSize(appId);
    return { size };
  }
}

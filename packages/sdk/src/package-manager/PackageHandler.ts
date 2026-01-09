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
  @EdenHandler("install")
  async handleInstallApp(args: { sourcePath: string }): Promise<AppManifest> {
    const { sourcePath } = args;
    return await this.packageManager.installApp(sourcePath);
  }

  /**
   * Uninstall an application by its ID.
   */
  @EdenHandler("uninstall")
  async handleUninstallApp(args: { appId: string }): Promise<boolean> {
    const { appId } = args;
    return await this.packageManager.uninstallApp(appId);
  }

  /**
   * List all installed applications.
   * @param showHidden - If true, includes overlay apps (hidden by default)
   */
  @EdenHandler("list")
  async handleListApps(args: { showHidden?: boolean }): Promise<AppManifest[]> {
    return this.packageManager.getInstalledApps(args.showHidden);
  }

  /**
   * Toggle hot reload for an app
   */
  @EdenHandler("toggle-hot-reload")
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
  @EdenHandler("is-hot-reload-enabled")
  async handleIsHotReloadEnabled(params: {
    appId: string;
  }): Promise<{ enabled: boolean }> {
    const enabled = await isHotReloadEnabled(params.appId);
    return { enabled };
  }

  /**
   * Get the icon for an installed application as a data URL.
   */
  @EdenHandler("get-icon")
  async handleGetAppIcon(args: {
    appId: string;
  }): Promise<{ icon: string | undefined }> {
    const { appId } = args;
    const icon = await this.packageManager.getAppIcon(appId);
    return { icon };
  }
}

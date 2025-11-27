import { AppManifest } from "../../types";
import { EdenHandler, EdenNamespace } from "../ipc";
import { PackageManager } from "./PackageManager";

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
   */
  @EdenHandler("list-installed")
  async handleListInstalledApps(
    args: Record<string, never>
  ): Promise<AppManifest[]> {
    return this.packageManager.getInstalledApps();
  }
}

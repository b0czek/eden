import { EdenHandler, EdenNamespace } from "../ipc";
import { PackageManager } from "./PackageManager";

@EdenNamespace("package")
export class PackageHandler {
  private packageManager: PackageManager;

  constructor(packageManager: PackageManager) {
    this.packageManager = packageManager;
  }

  @EdenHandler("install")
  async handleInstallApp(
    args: { sourcePath: string }
  ): Promise<any> {
    const { sourcePath } = args;
    return await this.packageManager.installApp(sourcePath);
  }

  @EdenHandler("uninstall")
  async handleUninstallApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    return await this.packageManager.uninstallApp(appId);
  }

  @EdenHandler("list-installed")
  async handleListInstalledApps(
    args: Record<string, never>
  ): Promise<any> {
    return this.packageManager.getInstalledApps();
  }
}

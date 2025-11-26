import { CommandHandler, CommandNamespace } from "../core/CommandDecorators";
import { PackageManager } from "./PackageManager";

@CommandNamespace("package")
export class PackageHandler {
  private packageManager: PackageManager;

  constructor(packageManager: PackageManager) {
    this.packageManager = packageManager;
  }

  @CommandHandler("install")
  async handleInstallApp(
    args: { sourcePath: string }
  ): Promise<any> {
    const { sourcePath } = args;
    return await this.packageManager.installApp(sourcePath);
  }

  @CommandHandler("uninstall")
  async handleUninstallApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    return await this.packageManager.uninstallApp(appId);
  }

  @CommandHandler("list-installed")
  async handleListInstalledApps(
    args: Record<string, never>
  ): Promise<any> {
    return this.packageManager.getInstalledApps();
  }
}

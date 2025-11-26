import { CommandHandler, CommandNamespace } from "../ipc/CommandDecorators";
import { ProcessManager } from "./ProcessManager";

@CommandNamespace("process")
export class ProcessHandler {
  private processManager: ProcessManager;

  constructor(processManager: ProcessManager) {
    this.processManager = processManager;
  }

  @CommandHandler("launch")
  async handleLaunchApp(
    args: { appId: string; bounds?: { x: number; y: number; width: number; height: number } }
  ): Promise<any> {
    const { appId, bounds } = args;
    return await this.processManager.launchApp(appId, bounds);
  }

  @CommandHandler("stop")
  async handleStopApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    await this.processManager.stopApp(appId);
    return { success: true };
  }

  @CommandHandler("list")
  async handleListApps(
    args: Record<string, never>
  ): Promise<any> {
    return this.processManager.getAllAppsStatus();
  }
}

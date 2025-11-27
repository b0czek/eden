import { ViewBounds } from "../../types";
import { EdenHandler, EdenNamespace } from "../ipc";
import { ProcessManager } from "./ProcessManager";

@EdenNamespace("process")
export class ProcessHandler {
  private processManager: ProcessManager;

  constructor(processManager: ProcessManager) {
    this.processManager = processManager;
  }

  @EdenHandler("launch")
  async handleLaunchApp(
    args: { appId: string; bounds?: ViewBounds }
  ): Promise<any> {
    const { appId, bounds } = args;
    return await this.processManager.launchApp(appId, bounds);
  }

  @EdenHandler("stop")
  async handleStopApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    await this.processManager.stopApp(appId);
    return { success: true };
  }

  @EdenHandler("list")
  async handleListApps(
    args: Record<string, never>
  ): Promise<any> {
    return this.processManager.getAllAppsStatus();
  }
}

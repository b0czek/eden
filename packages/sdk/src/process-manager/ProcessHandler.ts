import { AppInstance, LaunchResult, ViewBounds } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import { ProcessManager } from "./ProcessManager";

@EdenNamespace("process")
export class ProcessHandler {
  private processManager: ProcessManager;

  constructor(processManager: ProcessManager) {
    this.processManager = processManager;
  }

  /**
   * Launch an application instance.
   */
  @EdenHandler("launch")
  async handleLaunchApp(args: {
    appId: string;
    bounds?: ViewBounds;
  }): Promise<LaunchResult> {
    const { appId, bounds } = args;
    return await this.processManager.launchApp(appId, bounds);
  }

  /**
   * Stop a running application instance.
   */
  @EdenHandler("stop")
  async handleStopApp(args: { appId: string }): Promise<{ success: boolean }> {
    const { appId } = args;
    await this.processManager.stopApp(appId);
    return { success: true };
  }

  /**
   * List all running application processes.
   * @param showHidden - If true, includes overlay apps (hidden by default)
   */
  @EdenHandler("list")
  async handleListApps(args: { showHidden?: boolean }): Promise<AppInstance[]> {
    return this.processManager.getRunningApps(args.showHidden);
  }
}

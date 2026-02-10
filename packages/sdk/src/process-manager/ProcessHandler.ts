import type { AppInstance, LaunchResult, ViewBounds } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { ProcessManager } from "./ProcessManager";

@EdenNamespace("process")
export class ProcessHandler {
  private processManager: ProcessManager;

  constructor(processManager: ProcessManager) {
    this.processManager = processManager;
  }

  /**
   * Launch an application instance.
   * Requires "process/manage" permission.
   */
  @EdenHandler("launch", { permission: "manage" })
  async handleLaunchApp(args: {
    appId: string;
    bounds?: ViewBounds;
  }): Promise<LaunchResult> {
    const { appId, bounds } = args;
    return await this.processManager.launchApp(appId, bounds);
  }

  /**
   * Stop a running application instance.
   * Requires "process/manage" permission.
   */
  @EdenHandler("stop", { permission: "manage" })
  async handleStopApp(args: { appId: string }): Promise<{ success: boolean }> {
    const { appId } = args;
    await this.processManager.stopApp(appId);
    return { success: true };
  }

  /**
   * Stop the caller app instance.
   * No explicit permission required - this endpoint only allows self-exit.
   */
  @EdenHandler("exit")
  async handleExitApp(args: {
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const { _callerAppId } = args;
    if (!_callerAppId) {
      throw new Error("process/exit requires caller app context");
    }

    await this.processManager.stopApp(_callerAppId);
    return { success: true };
  }

  /**
   * List all running application processes.
   * Requires "process/read" permission.
   * @param showHidden - If true, includes overlay apps (hidden by default)
   */
  @EdenHandler("list", { permission: "read" })
  async handleListApps(args: { showHidden?: boolean }): Promise<AppInstance[]> {
    return this.processManager.getRunningApps(args.showHidden);
  }
}

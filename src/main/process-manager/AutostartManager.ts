import { injectable, inject, singleton } from "tsyringe";
import { EdenConfig } from "../../types";
import { ProcessManager } from "./ProcessManager";

/**
 * AutostartManager handles launching applications when Eden starts
 */
@singleton()
@injectable()
export class AutostartManager {
  constructor(
    @inject("EdenConfig") private config: EdenConfig,
    @inject(ProcessManager) private processManager: ProcessManager
  ) {}

  /**
   * Launch all autostart applications
   */
  async launchAll(): Promise<void> {
    const autostartApps = this.config.autostart || [];

    if (autostartApps.length === 0) {
      console.log("No autostart apps configured");
      return;
    }

    for (const appId of autostartApps) {
      try {
        await this.processManager.launchApp(appId);
        console.log(`Autostart app launched: ${appId}`);
      } catch (error) {
        console.error(`Failed to launch autostart app ${appId}:`, error);
      }
    }
  }
}

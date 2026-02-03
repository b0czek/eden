import { EdenHandler, EdenNamespace, IPCBridge, CommandRegistry } from "./ipc";
import { injectable, inject, singleton } from "tsyringe";
import { SystemInfo, EdenConfig } from "@edenapp/types";

@singleton()
@injectable()
@EdenNamespace("system")
export class SystemHandler {
  constructor(
    @inject(IPCBridge) private ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject("EdenConfig") private config: EdenConfig
  ) {
    commandRegistry.registerManager(this);
  }

  /**
   * Get system information including platform, versions, and running apps.
   */
  @EdenHandler("info")
  async handleSystemInfo(): Promise<SystemInfo> {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      runningApps: this.ipcBridge.getRunningAppIds(),
      release: this.config.development !== true,
    };
  }
}

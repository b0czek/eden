import type { EdenBrandingInfo, EdenConfig, SystemInfo } from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import { BrandingManager } from "./branding";
import { CommandRegistry, EdenHandler, EdenNamespace, IPCBridge } from "./ipc";

@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("system")
export class SystemHandler {
  constructor(
    @inject(IPCBridge) private ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject("EdenConfig") private config: EdenConfig,
    @inject(BrandingManager) private brandingManager: BrandingManager,
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

  /**
   * Get consumer-controlled product branding for SDK-owned interfaces.
   */
  @EdenHandler("branding")
  async handleBranding(): Promise<EdenBrandingInfo> {
    return this.brandingManager.getInfo();
  }
}

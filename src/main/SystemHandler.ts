import { EdenHandler, EdenNamespace, IPCBridge, CommandRegistry } from "./ipc";
import { injectable, inject } from "tsyringe";
import { SystemInfo, WindowSize } from "../types";

@injectable()
@EdenNamespace("system")
export class SystemHandler {
  constructor(
    @inject("IPCBridge") private ipcBridge: IPCBridge,
    @inject("CommandRegistry") commandRegistry: CommandRegistry
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
    };
  }

  /**
   * Get the current dimensions of the main window.
   */
  @EdenHandler("window-size")
  async handleGetWindowSize(): Promise<WindowSize> {
    const mainWindow = this.ipcBridge.getMainWindow();
    if (!mainWindow) {
      throw new Error("Main window not available");
    }

    const windowBounds = mainWindow.getBounds();
    return {
      width: windowBounds.width,
      height: windowBounds.height,
    };
  }
}

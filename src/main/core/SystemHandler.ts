import { CommandHandler, CommandNamespace } from "./CommandDecorators";
import { IPCBridge } from "./IPCBridge";

@CommandNamespace("system")
export class SystemHandler {
  private ipcBridge: IPCBridge;

  constructor(ipcBridge: IPCBridge) {
    this.ipcBridge = ipcBridge;
  }

  @CommandHandler("info")
  async handleSystemInfo(): Promise<any> {
    return {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      runningApps: this.ipcBridge.getRunningAppIds(),
    };
  }

  @CommandHandler("window-size")
  async handleGetWindowSize(): Promise<any> {
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

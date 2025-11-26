import { CommandHandler, CommandNamespace } from "./ipc/CommandDecorators";
import { IPCBridge } from "./ipc/IPCBridge";
import { injectable, inject } from "tsyringe";
import { CommandRegistry } from "./ipc/CommandRegistry";

@injectable()
@CommandNamespace("system")
export class SystemHandler {
  constructor(
    @inject("IPCBridge") private ipcBridge: IPCBridge,
    @inject("CommandRegistry") commandRegistry: CommandRegistry
  ) {
    commandRegistry.registerManager(this);
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

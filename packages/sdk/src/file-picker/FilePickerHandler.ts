import type { FilePickerOpenArgs, FilePickerResult } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { FilePickerManager } from "./FilePickerManager";

@EdenNamespace("file-picker")
export class FilePickerHandler {
  constructor(private manager: FilePickerManager) {}

  @EdenHandler("register-display", { permission: "display" })
  async handleRegisterDisplay(args: {
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): Promise<{ success: boolean }> {
    return this.manager.registerDisplayProvider({
      appId: args._callerAppId,
      webContentsId: args._callerWebContentsId,
    });
  }

  @EdenHandler("open")
  async handleOpen(
    args: FilePickerOpenArgs & {
      _callerAppId?: string;
      _callerWebContentsId?: number;
    },
  ): Promise<{ requestId: string }> {
    const { _callerAppId, _callerWebContentsId, ...pickerArgs } = args;
    return this.manager.openPicker(pickerArgs, {
      appId: _callerAppId,
      webContentsId: _callerWebContentsId,
    });
  }

  @EdenHandler("resolve", { permission: "display" })
  async handleResolve(
    args: FilePickerResult & {
      _callerAppId?: string;
      _callerWebContentsId?: number;
    },
  ): Promise<{ success: boolean }> {
    return this.manager.resolvePicker(args, {
      appId: args._callerAppId,
      webContentsId: args._callerWebContentsId,
    });
  }

  @EdenHandler("close")
  async handleClose(args: {
    requestId?: string;
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): Promise<{ success: boolean }> {
    return this.manager.closePicker(args.requestId, {
      appId: args._callerAppId,
      webContentsId: args._callerWebContentsId,
    });
  }
}

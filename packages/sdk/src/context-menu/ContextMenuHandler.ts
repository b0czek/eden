import type { ContextMenuOpenArgs, ContextMenuResult } from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import type { ContextMenuManager } from "./ContextMenuManager";

@EdenNamespace("context-menu")
export class ContextMenuHandler {
  constructor(private manager: ContextMenuManager) {}

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
    args: ContextMenuOpenArgs & {
      _callerAppId?: string;
      _callerWebContentsId?: number;
    },
  ): Promise<{ requestId: string }> {
    return this.manager.openMenu(args, {
      appId: args._callerAppId,
      webContentsId: args._callerWebContentsId,
    });
  }

  @EdenHandler("resolve", { permission: "display" })
  async handleResolve(
    args: ContextMenuResult & { _callerAppId?: string },
  ): Promise<{ success: boolean }> {
    return this.manager.resolveMenu(args);
  }

  @EdenHandler("close")
  async handleClose(args: {
    requestId?: string;
    _callerAppId?: string;
    _callerWebContentsId?: number;
  }): Promise<{ success: boolean }> {
    return this.manager.closeMenu(args.requestId, {
      appId: args._callerAppId,
      webContentsId: args._callerWebContentsId,
    });
  }
}

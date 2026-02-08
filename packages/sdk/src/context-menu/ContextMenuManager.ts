import type {
  ContextMenuOpenArgs,
  ContextMenuOpenEvent,
  ContextMenuPosition,
  ContextMenuResult,
} from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { ViewManager } from "../view-manager";
import { ContextMenuHandler } from "./ContextMenuHandler";

interface ContextMenuNamespaceEvents {
  opened: { menu: ContextMenuOpenEvent };
  closed: ContextMenuResult;
}

interface ContextMenuCaller {
  appId?: string;
  webContentsId?: number;
}

interface ContextMenuRequestContext {
  requestId: string;
  opener: {
    appId: string;
    viewId?: number;
  };
}

interface DisplayProvider {
  appId: string;
  viewId: number;
}

@singleton()
@injectable()
@EdenNamespace("context-menu")
export class ContextMenuManager extends EdenEmitter<ContextMenuNamespaceEvents> {
  private handler: ContextMenuHandler;
  private idCounter = 0;
  private activeRequest: ContextMenuRequestContext | null = null;
  private displayProvider: DisplayProvider | null = null;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(ViewManager) private viewManager: ViewManager,
  ) {
    super(ipcBridge);

    this.handler = new ContextMenuHandler(this);
    commandRegistry.registerManager(this.handler);
  }

  private generateId(): string {
    return `ctx-${Date.now()}-${++this.idCounter}`;
  }

  /**
   * Register the display provider (context menu renderer app).
   * Only the display provider receives all context menu events.
   * Permission-gated via handler.
   */
  registerDisplayProvider(caller: ContextMenuCaller): { success: boolean } {
    const viewId = this.resolveCallerViewId(caller.webContentsId);
    if (viewId === undefined || !caller.appId) {
      throw new Error("Display provider must be a valid view");
    }

    this.displayProvider = { appId: caller.appId, viewId };
    log.info(`Context menu display provider registered: ${caller.appId}`);
    return { success: true };
  }

  /**
   * Send event to display provider and opener only (targeted multicast).
   */
  private notifyContextMenu<K extends keyof ContextMenuNamespaceEvents>(
    event: K,
    payload: ContextMenuNamespaceEvents[K],
    openerViewId?: number,
  ): void {
    // Notify display provider (if registered)
    if (this.displayProvider) {
      this.notifySubscriber(this.displayProvider.viewId, event, payload);
    }

    // Notify opener
    if (openerViewId !== undefined) {
      this.notifySubscriber(openerViewId, event, payload);
    }
  }

  private toGlobalPosition(
    position: ContextMenuPosition,
    callerViewId?: number,
  ): ContextMenuPosition {
    if (callerViewId === undefined) return position;

    const viewInfo = this.viewManager.getViewInfo(callerViewId);
    if (!viewInfo) return position;

    return this.toPositionFromView(position, viewInfo.bounds);
  }

  private toPositionFromView(
    position: ContextMenuPosition,
    bounds: { x: number; y: number; width: number; height: number },
  ): ContextMenuPosition {
    const windowSize = this.viewManager.getWindowSize();

    const rightOffset = windowSize.width - (bounds.x + bounds.width);
    const bottomOffset = windowSize.height - (bounds.y + bounds.height);

    return {
      left: position.left !== undefined ? position.left + bounds.x : undefined,
      top: position.top !== undefined ? position.top + bounds.y : undefined,
      right:
        position.right !== undefined ? position.right + rightOffset : undefined,
      bottom:
        position.bottom !== undefined
          ? position.bottom + bottomOffset
          : undefined,
    };
  }

  private resolveCallerViewId(webContentsId?: number): number | undefined {
    if (webContentsId === undefined) return undefined;
    const viewId = this.viewManager.getViewIdByWebContentsId(webContentsId);
    if (viewId === undefined) {
      log.warn(
        `Context menu caller view not found for webContents ${webContentsId}`,
      );
    }
    return viewId;
  }

  private isCallerAuthorized(
    caller: ContextMenuCaller,
    opener: ContextMenuRequestContext["opener"],
  ): boolean {
    if (opener.viewId !== undefined) {
      const callerViewId = this.resolveCallerViewId(caller.webContentsId);
      return callerViewId !== undefined && callerViewId === opener.viewId;
    }

    return false;
  }

  openMenu(
    args: ContextMenuOpenArgs,
    caller?: ContextMenuCaller,
  ): { requestId: string } {
    const callerAppId = caller?.appId;
    if (!callerAppId) {
      throw new Error("Caller app ID is required to open context menus");
    }

    const callerViewId = this.resolveCallerViewId(caller?.webContentsId);
    if (callerViewId === undefined) {
      throw new Error("Context menus can only be opened from a renderer view");
    }
    if (this.displayProvider && callerViewId === this.displayProvider.viewId) {
      throw new Error("Display provider cannot open context menus");
    }
    const requestId = this.generateId();

    const previousRequest = this.activeRequest;
    if (previousRequest) {
      this.activeRequest = null;
      this.notifyContextMenu(
        "closed",
        {
          requestId: previousRequest.requestId,
          reason: "replaced",
        },
        previousRequest.opener.viewId,
      );
    }

    this.activeRequest = {
      requestId,
      opener: {
        appId: callerAppId,
        viewId: callerViewId,
      },
    };

    const menu: ContextMenuOpenEvent = {
      requestId,
      title: args.title,
      position: this.toGlobalPosition(args.position, callerViewId),
      items: args.items,
    };

    this.notifyContextMenu("opened", { menu }, callerViewId);
    log.info(`Context menu opened (${requestId})`);

    return { requestId };
  }

  resolveMenu(result: ContextMenuResult): { success: boolean } {
    if (
      !this.activeRequest ||
      this.activeRequest.requestId !== result.requestId
    ) {
      return { success: false };
    }

    const openerViewId = this.activeRequest.opener.viewId;
    this.activeRequest = null;

    this.notifyContextMenu("closed", result, openerViewId);
    return { success: true };
  }

  closeMenu(
    requestId: string | undefined,
    caller?: ContextMenuCaller,
  ): { success: boolean } {
    if (!this.activeRequest) return { success: false };

    const targetId = requestId ?? this.activeRequest.requestId;
    if (targetId !== this.activeRequest.requestId) {
      return { success: false };
    }

    if (!caller?.appId) {
      throw new Error("Caller app ID is required to close context menus");
    }

    if (!this.isCallerAuthorized(caller, this.activeRequest.opener)) {
      log.warn(
        `Context menu close denied for ${caller.appId} (request ${targetId})`,
      );
      throw new Error("Only the original opener can close this menu");
    }

    const openerViewId = this.activeRequest.opener.viewId;
    this.activeRequest = null;

    this.notifyContextMenu(
      "closed",
      { requestId: targetId, reason: "close" },
      openerViewId,
    );
    return { success: true };
  }
}

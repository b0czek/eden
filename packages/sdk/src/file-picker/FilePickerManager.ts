import type {
  FilePickerOpenArgs,
  FilePickerOpenEvent,
  FilePickerResult,
  ViewBounds,
} from "@edenapp/types";
import { inject, injectable, singleton } from "tsyringe";
import { CommandRegistry, EdenEmitter, EdenNamespace, IPCBridge } from "../ipc";
import { log } from "../logging";
import { NotificationManager } from "../notification";
import { ViewManager } from "../view-manager";
import { FilePickerHandler } from "./FilePickerHandler";

interface FilePickerNamespaceEvents {
  opened: { picker: FilePickerOpenEvent };
  closed: FilePickerResult;
}

interface FilePickerCaller {
  appId?: string;
  webContentsId?: number;
}

interface FilePickerRequestContext {
  requestId: string;
  opener: {
    appId: string;
    viewId: number;
  };
}

interface DisplayProvider {
  appId: string;
  viewId: number;
}

@singleton()
@injectable()
@EdenNamespace("file-picker")
export class FilePickerManager extends EdenEmitter<FilePickerNamespaceEvents> {
  private handler: FilePickerHandler;
  private idCounter = 0;
  private activeRequest: FilePickerRequestContext | null = null;
  private displayProvider: DisplayProvider | null = null;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(ViewManager) private viewManager: ViewManager,
    @inject(NotificationManager)
    private notificationManager: NotificationManager,
  ) {
    super(ipcBridge);

    this.handler = new FilePickerHandler(this);
    commandRegistry.registerManager(this.handler);
  }

  private generateId(): string {
    return `file-picker-${Date.now()}-${++this.idCounter}`;
  }

  registerDisplayProvider(caller: FilePickerCaller): { success: boolean } {
    const viewId = this.resolveCallerViewId(caller.webContentsId);
    if (viewId === undefined || !caller.appId) {
      throw new Error("File picker display provider must be a valid view");
    }

    this.displayProvider = { appId: caller.appId, viewId };
    log.info(`File picker display provider registered: ${caller.appId}`);
    return { success: true };
  }

  private notifyFilePicker<K extends keyof FilePickerNamespaceEvents>(
    event: K,
    payload: FilePickerNamespaceEvents[K],
    openerViewId?: number,
  ): void {
    if (this.displayProvider) {
      this.notifySubscriber(this.displayProvider.viewId, event, payload);
    }

    if (openerViewId !== undefined) {
      this.notifySubscriber(openerViewId, event, payload);
    }
  }

  private resolveCallerViewId(webContentsId?: number): number | undefined {
    if (webContentsId === undefined) return undefined;
    const viewId = this.viewManager.getViewIdByWebContentsId(webContentsId);
    if (viewId === undefined) {
      log.warn(
        `File picker caller view not found for webContents ${webContentsId}`,
      );
    }
    return viewId;
  }

  private getViewBounds(viewId: number): ViewBounds | undefined {
    const viewInfo = this.viewManager.getViewInfo(viewId);
    return viewInfo?.bounds;
  }

  private isCallerAuthorized(
    caller: FilePickerCaller,
    opener: FilePickerRequestContext["opener"],
  ): boolean {
    const callerViewId = this.resolveCallerViewId(caller.webContentsId);
    return callerViewId !== undefined && callerViewId === opener.viewId;
  }

  private isDisplayProvider(caller: FilePickerCaller): boolean {
    if (!this.displayProvider || !caller.appId) return false;
    const callerViewId = this.resolveCallerViewId(caller.webContentsId);
    return callerViewId === this.displayProvider.viewId;
  }

  private notifyBusy(): void {
    this.notificationManager.pushNotification(
      "File picker is busy",
      "Resolve the current file picker before opening another.",
      5000,
      "warning",
    );
  }

  openPicker(
    args: FilePickerOpenArgs,
    caller?: FilePickerCaller,
  ): { requestId: string } {
    const callerAppId = caller?.appId;
    if (!callerAppId) {
      throw new Error("Caller app ID is required to open file pickers");
    }

    const callerViewId = this.resolveCallerViewId(caller?.webContentsId);
    if (callerViewId === undefined) {
      throw new Error("File pickers can only be opened from a renderer view");
    }
    if (this.displayProvider && callerViewId === this.displayProvider.viewId) {
      throw new Error("Display provider cannot open file pickers");
    }
    if (!this.displayProvider) {
      throw new Error("File picker display provider is not registered");
    }
    if (this.activeRequest) {
      this.notifyBusy();
      throw new Error(
        "File picker is busy. Resolve the current file picker before opening another.",
      );
    }

    const requestId = this.generateId();
    this.activeRequest = {
      requestId,
      opener: {
        appId: callerAppId,
        viewId: callerViewId,
      },
    };

    const picker: FilePickerOpenEvent = {
      ...args,
      requestId,
      opener: {
        appId: callerAppId,
        viewId: callerViewId,
        bounds: this.getViewBounds(callerViewId),
      },
    };

    this.notifyFilePicker("opened", { picker }, callerViewId);
    this.viewManager.showView(this.displayProvider.viewId);
    this.viewManager.focusView(this.displayProvider.viewId);
    log.info(`File picker opened (${requestId})`);

    return { requestId };
  }

  resolvePicker(
    result: FilePickerResult,
    caller?: FilePickerCaller,
  ): { success: boolean } {
    if (!this.isDisplayProvider(caller ?? {})) {
      throw new Error("Only the display provider can resolve file pickers");
    }

    if (
      !this.activeRequest ||
      this.activeRequest.requestId !== result.requestId
    ) {
      return { success: false };
    }

    const openerViewId = this.activeRequest.opener.viewId;
    this.activeRequest = null;

    this.notifyFilePicker("closed", result, openerViewId);
    return { success: true };
  }

  closePicker(
    requestId: string | undefined,
    caller?: FilePickerCaller,
  ): { success: boolean } {
    if (!this.activeRequest) return { success: false };

    const targetId = requestId ?? this.activeRequest.requestId;
    if (targetId !== this.activeRequest.requestId) {
      return { success: false };
    }

    if (!caller?.appId) {
      throw new Error("Caller app ID is required to close file pickers");
    }

    if (!this.isCallerAuthorized(caller, this.activeRequest.opener)) {
      log.warn(
        `File picker close denied for ${caller.appId} (request ${targetId})`,
      );
      throw new Error("Only the original opener can close this file picker");
    }

    const openerViewId = this.activeRequest.opener.viewId;
    this.activeRequest = null;

    this.notifyFilePicker(
      "closed",
      { requestId: targetId, reason: "close" },
      openerViewId,
    );
    return { success: true };
  }
}

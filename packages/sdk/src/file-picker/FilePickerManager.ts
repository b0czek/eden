import type {
  FilePickerOpenArgs,
  FilePickerOpenEvent,
  FilePickerResult,
  ViewBounds,
} from "@edenapp/types";
import { inject, injectable, Lifecycle, scoped } from "tsyringe";
import * as v from "valibot";
import { AppAssociationManager } from "../app-associations";
import { filesystemLocationSchema } from "../filesystem/FilesystemLocationSchema";
import { VolumeManager } from "../filesystem/VolumeManager";
import {
  CommandRegistry,
  EdenEmitter,
  EdenNamespace,
  IPCBridge,
  PermissionRegistry,
} from "../ipc";
import { log } from "../logging";
import { NotificationManager } from "../notification";
import { IdleProcessStopper, ProcessManager } from "../process-manager";
import { DisplayProviderRegistry, ViewManager } from "../view-manager";
import { isViewAlive } from "../view-manager/viewLifecycle";
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
  allowedVolumes?: string[];
  mode: "open" | "save";
  opener: {
    appId: string;
    viewId: number;
  };
}

const FORCE_OPEN_ACTION_ID = "force-open-file-picker";
const IDLE_STOP_DELAY_MS = 10_000;
const FILE_PICKER_PROVIDER_ASSOCIATION = "provider:file-picker";
const FILE_PICKER_DISPLAY_PERMISSION = "file-picker/display";
const PROVIDER_REGISTRATION_TIMEOUT_MS = 5_000;

@scoped(Lifecycle.ContainerScoped)
@injectable()
@EdenNamespace("file-picker")
export class FilePickerManager extends EdenEmitter<FilePickerNamespaceEvents> {
  private handler: FilePickerHandler;
  private idCounter = 0;
  private activeRequest: FilePickerRequestContext | null = null;
  private displayProviders: DisplayProviderRegistry;
  private idleProviderStopper: IdleProcessStopper;

  constructor(
    @inject(IPCBridge) ipcBridge: IPCBridge,
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(ViewManager) private viewManager: ViewManager,
    @inject(NotificationManager)
    private notificationManager: NotificationManager,
    @inject(ProcessManager) private processManager: ProcessManager,
    @inject(AppAssociationManager)
    private appAssociationManager: AppAssociationManager,
    @inject(PermissionRegistry)
    private permissionRegistry: PermissionRegistry,
    @inject(VolumeManager) private volumes: VolumeManager,
  ) {
    super(ipcBridge);

    this.displayProviders = new DisplayProviderRegistry(
      this.viewManager,
      "File picker",
    );
    this.idleProviderStopper = new IdleProcessStopper(
      this.processManager,
      IDLE_STOP_DELAY_MS,
      "file picker provider",
    );
    this.handler = new FilePickerHandler(this);
    commandRegistry.registerManager(this.handler);
    this.processManager.on("stopped", ({ appId }) => {
      this.handleAppStopped(appId);
    });
  }

  private generateId(): string {
    return `file-picker-${Date.now()}-${++this.idCounter}`;
  }

  private closeActiveRequest(reason: FilePickerResult["reason"]): void {
    if (!this.activeRequest) return;

    const { requestId, opener } = this.activeRequest;
    this.activeRequest = null;
    this.notifyFilePicker("closed", { requestId, reason }, opener.viewId);
    this.idleProviderStopper.schedule();
  }

  private pruneStaleState(): void {
    const provider = this.displayProviders.getProvider();
    if (this.displayProviders.clearIfStale()) {
      this.idleProviderStopper.clearTarget(provider?.appId);
      this.closeActiveRequest("close");
      return;
    }

    if (
      this.activeRequest &&
      !isViewAlive(
        this.viewManager.getViewInfo(this.activeRequest.opener.viewId)?.view,
      )
    ) {
      this.closeActiveRequest("close");
    }
  }

  private handleAppStopped(appId: string): void {
    if (this.displayProviders.clearIfAppStopped(appId)) {
      this.idleProviderStopper.clearTarget(appId);
      this.closeActiveRequest("close");
      return;
    }

    if (this.activeRequest?.opener.appId === appId) {
      this.closeActiveRequest("close");
    }
  }

  registerDisplayProvider(caller: FilePickerCaller): { success: boolean } {
    if (this.activeRequest) {
      this.closeActiveRequest("close");
    }

    const result = this.displayProviders.register(caller);
    if (result.success && caller.appId) {
      this.idleProviderStopper.setTarget(caller.appId);
    }
    return result;
  }

  private notifyFilePicker<K extends keyof FilePickerNamespaceEvents>(
    event: K,
    payload: FilePickerNamespaceEvents[K],
    openerViewId?: number,
  ): void {
    const provider = this.displayProviders.getProvider();
    if (provider) {
      this.notifySubscriber(provider.viewId, event, payload);
    }

    if (openerViewId !== undefined) {
      this.notifySubscriber(openerViewId, event, payload);
    }
  }

  private getViewBounds(viewId: number): ViewBounds | undefined {
    const viewInfo = this.viewManager.getViewInfo(viewId);
    return viewInfo?.bounds;
  }

  private isCallerAuthorized(
    caller: FilePickerCaller,
    opener: FilePickerRequestContext["opener"],
  ): boolean {
    const callerViewId = this.displayProviders.resolveCallerViewId(
      caller.webContentsId,
    );
    return callerViewId !== undefined && callerViewId === opener.viewId;
  }

  private notifyBusy(args: FilePickerOpenArgs, caller: FilePickerCaller): void {
    this.notificationManager.pushNotification(
      "File picker is busy",
      "Resolve the current file picker before opening another.",
      0,
      "warning",
      [
        {
          id: FORCE_OPEN_ACTION_ID,
          label: "Force open",
        },
      ],
      {
        [FORCE_OPEN_ACTION_ID]: async () => {
          await this.forceOpenPicker(args, caller);
        },
      },
    );
  }

  private async ensureDisplayProvider(): Promise<void> {
    if (this.displayProviders.getProvider()) {
      return;
    }

    const providers = this.appAssociationManager.resolve(
      FILE_PICKER_PROVIDER_ASSOCIATION,
      (app) =>
        this.permissionRegistry.hasPermission(
          app.id,
          FILE_PICKER_DISPLAY_PERMISSION,
        ),
    );
    if (providers.length === 0) {
      throw new Error(
        "No file picker display provider is installed or permitted",
      );
    }
    if (providers.length > 1) {
      throw new Error(
        `Multiple file picker display providers are available: ${providers
          .map((provider) => provider.appId)
          .join(", ")}`,
      );
    }

    const [provider] = providers;
    await this.processManager.ensureAppRunning(provider.appId);
    await this.displayProviders.waitFor(
      provider.appId,
      PROVIDER_REGISTRATION_TIMEOUT_MS,
    );
  }

  async openPicker(
    args: FilePickerOpenArgs,
    caller?: FilePickerCaller,
  ): Promise<{ requestId: string }> {
    this.pruneStaleState();
    if (
      args.allowedVolumes &&
      (!Array.isArray(args.allowedVolumes) || !args.allowedVolumes.length)
    ) {
      throw new Error("File picker requires at least one allowed volume");
    }
    for (const id of args.allowedVolumes ?? []) this.volumes.get(id);
    if (args.initialLocation) {
      const location = args.initialLocation;
      if (
        typeof location.volume !== "string" ||
        typeof location.path !== "string"
      )
        throw new Error("Initial location requires volume and path");
      this.volumes.get(location.volume);
      if (args.allowedVolumes && !args.allowedVolumes.includes(location.volume))
        throw new Error("Initial volume is not allowed");
    }

    const callerAppId = caller?.appId;
    if (!callerAppId) {
      throw new Error("Caller app ID is required to open file pickers");
    }

    const callerViewId = this.displayProviders.resolveCallerViewId(
      caller?.webContentsId,
    );
    if (callerViewId === undefined) {
      throw new Error("File pickers can only be opened from a renderer view");
    }
    const currentProvider = this.displayProviders.getProvider();
    if (currentProvider && callerViewId === currentProvider.viewId) {
      throw new Error("Display provider cannot open file pickers");
    }
    if (!currentProvider) {
      await this.ensureDisplayProvider();
    }
    const provider = this.displayProviders.getProvider();
    if (!provider) {
      throw new Error("File picker display provider is not registered");
    }
    if (this.activeRequest) {
      const blockedArgs = { ...args };
      const blockedCaller = { ...(caller ?? {}) };
      this.notifyBusy(blockedArgs, blockedCaller);
      throw new Error(
        "File picker is busy. Resolve the current file picker before opening another.",
      );
    }

    this.idleProviderStopper.cancel();

    const requestId = this.generateId();
    this.activeRequest = {
      requestId,
      mode: args.mode,
      allowedVolumes: args.allowedVolumes
        ? [...args.allowedVolumes]
        : undefined,
      opener: {
        appId: callerAppId,
        viewId: callerViewId,
      },
    };

    const picker: FilePickerOpenEvent = {
      ...args,
      initialLocation: args.initialLocation ?? {
        volume: args.allowedVolumes?.[0] ?? "home",
        path: "/",
      },
      requestId,
      opener: {
        appId: callerAppId,
        viewId: callerViewId,
        bounds: this.getViewBounds(callerViewId),
      },
    };

    this.notifyFilePicker("opened", { picker }, callerViewId);
    this.viewManager.showView(provider.viewId);
    this.viewManager.focusView(provider.viewId);
    log.info(`File picker opened (${requestId})`);

    return { requestId };
  }

  private async forceOpenPicker(
    args: FilePickerOpenArgs,
    caller: FilePickerCaller,
  ): Promise<{ requestId: string }> {
    this.pruneStaleState();

    if (this.activeRequest) {
      this.closeActiveRequest("close");
    }

    return await this.openPicker(args, caller);
  }

  resolvePicker(
    result: FilePickerResult,
    caller?: FilePickerCaller,
  ): { success: boolean } {
    if (!this.displayProviders.isProvider(caller ?? {})) {
      throw new Error("Only the display provider can resolve file pickers");
    }

    if (
      !this.activeRequest ||
      this.activeRequest.requestId !== result.requestId
    ) {
      return { success: false };
    }

    if (result.reason === "select") {
      if (!Array.isArray(result.locations) || !result.locations.length)
        throw new Error(
          "File picker selection requires a nonempty locations array",
        );
      for (const location of result.locations) {
        v.parse(filesystemLocationSchema, location);
        const volume = this.volumes.get(location.volume);
        if (
          this.activeRequest.allowedVolumes &&
          !this.activeRequest.allowedVolumes.includes(location.volume)
        )
          throw new Error("Selected volume is not allowed");
        if (this.activeRequest.mode === "save" && volume.readOnly)
          throw new Error("Selected volume is read-only");
      }
    }
    const openerViewId = this.activeRequest.opener.viewId;
    this.activeRequest = null;

    this.notifyFilePicker("closed", result, openerViewId);
    this.idleProviderStopper.schedule();
    return { success: true };
  }

  closePicker(
    requestId: string | undefined,
    caller?: FilePickerCaller,
  ): { success: boolean } {
    this.pruneStaleState();
    if (!this.activeRequest) return { success: false };

    const targetId = requestId ?? this.activeRequest.requestId;
    if (targetId !== this.activeRequest.requestId) {
      return { success: false };
    }

    if (!caller?.appId) {
      throw new Error("Caller app ID is required to close file pickers");
    }

    if (this.displayProviders.isProvider(caller)) {
      this.closeActiveRequest("close");
      return { success: true };
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
    this.idleProviderStopper.schedule();
    return { success: true };
  }

  override dispose(): void {
    this.activeRequest = null;
    this.idleProviderStopper.dispose();
    this.displayProviders.dispose();
    super.dispose();
  }
}

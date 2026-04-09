import * as fs from "node:fs";
import * as path from "node:path";
import type {
  EdenKeyboardAction,
  EdenKeyboardFocusState,
  EdenKeyboardInsetState,
  EdenKeyboardLayout,
  EdenKeyboardPlacementMode,
  EdenKeyboardState,
  EdenKeyboardTarget,
  ViewBounds,
} from "@edenapp/types";
import { BrowserWindow, ipcMain } from "electron";
import { delay, inject, injectable, singleton } from "tsyringe";
import { IPCBridge } from "../ipc";
import { log } from "../logging";
import { EDEN_SETTINGS_APP_ID, SettingsManager } from "../settings";
import { ViewManager } from "../view-manager";
import {
  calculateDefaultFloatingKeyboardBounds,
  calculateDockedKeyboardBounds,
  calculateDockedKeyboardLift,
  calculateKeyboardLayout,
} from "./geometry";

const CHANNEL_FOCUS_STATE = "eden-keyboard:focus-state";
const CHANNEL_SHOW = "eden-keyboard:show";
const CHANNEL_SEND_ACTION = "eden-keyboard:send-action";
const CHANNEL_HIDE = "eden-keyboard:hide";
const CHANNEL_APPLY_ACTION = "eden-keyboard:apply-action";
const CHANNEL_STATE_CHANGED = "eden-keyboard:state-changed";
const CHANNEL_GET_STATE = "eden-keyboard:get-state";

const SETTING_ENABLED = "keyboard.enabled";
const SETTING_PLACEMENT_MODE = "keyboard.placementMode";
const SETTING_SHOW_NUMBER_ROW = "keyboard.showNumberRow";
const DEFAULT_ENABLED = true;
const DEFAULT_PLACEMENT_MODE: EdenKeyboardPlacementMode = "docked";
const DEFAULT_SHOW_NUMBER_ROW = true;

type KeyboardTargetSession = {
  appId: string;
  viewId: number;
  sessionId: number;
  target?: EdenKeyboardTarget;
  targetBounds?: EdenKeyboardFocusState["targetBounds"];
};

@singleton()
@injectable()
export class KeyboardManager {
  private mainWindow: BrowserWindow | null = null;
  private keyboardWindow: BrowserWindow | null = null;
  private workspaceBounds: ViewBounds | null = null;
  private currentTarget: KeyboardTargetSession | null = null;
  private dismissedTarget: Pick<
    KeyboardTargetSession,
    "viewId" | "sessionId"
  > | null = null;
  private floatingBounds: ViewBounds | null = null;
  private enabled = DEFAULT_ENABLED;
  private placementMode: EdenKeyboardPlacementMode = DEFAULT_PLACEMENT_MODE;
  private showNumberRow = DEFAULT_SHOW_NUMBER_ROW;
  private readonly keyboardFrontendPath = path.join(
    __dirname,
    "../keyboard-ui/index.html",
  );
  private readonly keyboardPreloadPath = path.join(
    __dirname,
    "../foundation/keyboard-preload.js",
  );

  constructor(
    @inject(IPCBridge) private readonly ipcBridge: IPCBridge,
    @inject(ViewManager) private readonly viewManager: ViewManager,
    @inject(delay(() => SettingsManager))
    private readonly settingsManager: SettingsManager,
  ) {
    this.setupEventSubscriptions();
    this.setupIPCHandlers();
    void this.initializeSettings();
  }

  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    this.attachMainWindowTracking(window);
    this.ensureKeyboardWindow();
  }

  private setupEventSubscriptions(): void {
    this.ipcBridge.eventSubscribers.subscribeInternal(
      "view/global-bounds-changed",
      ({ workspaceBounds }) => {
        this.workspaceBounds = workspaceBounds;
        if (this.isKeyboardVisible() && this.placementMode === "docked") {
          this.refreshKeyboardPresentation().catch((error) => {
            log.error("Failed to reposition keyboard overlay:", error);
          });
        }
      },
    );

    this.ipcBridge.eventSubscribers.subscribeInternal(
      "process/stopped",
      ({ appId }) => {
        if (this.currentTarget?.appId === appId) {
          this.currentTarget = null;
          this.dismissedTarget = null;
          void this.hideKeyboard();
        }
      },
    );

    this.ipcBridge.eventSubscribers.subscribeInternal(
      "settings/changed",
      (data) => {
        if (data.appId !== EDEN_SETTINGS_APP_ID) {
          return;
        }

        if (data.key === SETTING_PLACEMENT_MODE) {
          const nextMode = this.parsePlacementMode(data.value);
          if (nextMode === this.placementMode) {
            return;
          }

          this.placementMode = nextMode;
          void this.refreshKeyboardPresentation();
          return;
        }

        if (data.key === SETTING_SHOW_NUMBER_ROW) {
          this.showNumberRow = data.value !== "false";
          this.notifyKeyboardStateChanged();
          return;
        }

        if (data.key === SETTING_ENABLED) {
          const nextEnabled = data.value !== "false";
          if (nextEnabled === this.enabled) {
            return;
          }

          this.enabled = nextEnabled;
          if (!this.enabled) {
            this.dismissedTarget = null;
            void this.hideKeyboard();
            return;
          }

          if (this.currentTarget) {
            void this.showKeyboard();
          }
        }
      },
    );
  }

  private setupIPCHandlers(): void {
    ipcMain.on(
      CHANNEL_FOCUS_STATE,
      (event, payload: EdenKeyboardFocusState | undefined) => {
        this.handleFocusState(event.sender.id, payload);
      },
    );

    ipcMain.handle(CHANNEL_SHOW, async () => {
      return await this.handleShowRequest();
    });

    ipcMain.handle(
      CHANNEL_SEND_ACTION,
      async (event, action: EdenKeyboardAction | undefined) => {
        return await this.handleActionRequest(event.sender.id, action);
      },
    );

    ipcMain.handle(CHANNEL_HIDE, async (event) => {
      return await this.handleHideRequest(event.sender.id);
    });

    ipcMain.handle(CHANNEL_GET_STATE, async () => {
      return this.getKeyboardState();
    });
  }

  private attachMainWindowTracking(window: BrowserWindow): void {
    window.on("move", () => {
      if (this.isKeyboardVisible() && this.placementMode === "docked") {
        void this.refreshKeyboardPresentation();
      }
    });

    window.on("resize", () => {
      if (this.isKeyboardVisible() && this.placementMode === "docked") {
        void this.refreshKeyboardPresentation();
      }
    });

    window.on("closed", () => {
      this.mainWindow = null;
      this.destroyKeyboardWindow();
    });
  }

  private handleFocusState(
    senderWebContentsId: number,
    payload: EdenKeyboardFocusState | undefined,
  ): void {
    if (!payload || typeof payload.visible !== "boolean") {
      return;
    }

    const appId = this.viewManager.getAppIdByWebContentsId(senderWebContentsId);
    const viewId =
      this.viewManager.getViewIdByWebContentsId(senderWebContentsId);
    if (!appId || viewId === undefined) {
      return;
    }

    if (!payload.visible) {
      if (this.dismissedTarget?.viewId === viewId) {
        this.dismissedTarget = null;
      }

      if (this.currentTarget?.viewId === viewId) {
        this.currentTarget = null;
        void this.hideKeyboard();
      }
      return;
    }

    this.currentTarget = {
      appId,
      viewId,
      sessionId: payload.sessionId,
      target: payload.target,
      targetBounds: payload.targetBounds,
    };

    if (!this.enabled) {
      return;
    }

    if (
      this.dismissedTarget?.viewId === viewId &&
      this.dismissedTarget.sessionId === payload.sessionId
    ) {
      return;
    }

    this.dismissedTarget = null;
    void this.showKeyboard();
  }

  private async handleActionRequest(
    senderWebContentsId: number,
    action: EdenKeyboardAction | undefined,
  ): Promise<{ success: boolean }> {
    if (!action) {
      return { success: false };
    }

    if (senderWebContentsId !== this.keyboardWindow?.webContents.id) {
      throw new Error("Only the keyboard window can dispatch keyboard actions");
    }

    const target = this.currentTarget;
    if (!target) {
      return { success: false };
    }

    const targetViewInfo = this.viewManager.getViewInfo(target.viewId);
    if (!targetViewInfo) {
      this.currentTarget = null;
      await this.hideKeyboard();
      return { success: false };
    }

    this.mainWindow?.focus();
    this.viewManager.focusView(target.viewId);
    const sent = this.viewManager.sendToView(
      target.viewId,
      CHANNEL_APPLY_ACTION,
      action,
    );

    if (!sent) {
      this.currentTarget = null;
      await this.hideKeyboard();
    }

    return { success: sent };
  }

  private async handleShowRequest(): Promise<{ success: boolean }> {
    this.dismissedTarget = null;
    await this.showKeyboard();
    return { success: true };
  }

  private async handleHideRequest(
    _senderWebContentsId: number,
  ): Promise<{ success: boolean }> {
    if (this.currentTarget) {
      this.dismissedTarget = {
        viewId: this.currentTarget.viewId,
        sessionId: this.currentTarget.sessionId,
      };
    }

    await this.hideKeyboard();
    return { success: true };
  }

  private ensureKeyboardWindow(): BrowserWindow | undefined {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return undefined;
    }

    if (this.keyboardWindow && !this.keyboardWindow.isDestroyed()) {
      return this.keyboardWindow;
    }

    if (!fs.existsSync(this.keyboardFrontendPath)) {
      log.error(
        `Keyboard frontend not found at ${this.keyboardFrontendPath}. Build the SDK apps first.`,
      );
      return undefined;
    }

    if (!fs.existsSync(this.keyboardPreloadPath)) {
      log.error(
        `Keyboard preload not found at ${this.keyboardPreloadPath}. Build/copy SDK foundation assets first.`,
      );
      return undefined;
    }

    const keyboardWindow = new BrowserWindow({
      parent: this.mainWindow,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: "#00000000",
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: this.keyboardPreloadPath,
        backgroundThrottling: false,
        scrollBounce: false,
        spellcheck: false,
      },
    });

    keyboardWindow.setAlwaysOnTop(true, "screen-saver");
    keyboardWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    });
    keyboardWindow.setMovable(this.placementMode === "floating");
    keyboardWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    keyboardWindow.webContents.on("did-finish-load", () => {
      this.notifyKeyboardStateChanged();
    });
    keyboardWindow.on("closed", () => {
      if (this.keyboardWindow === keyboardWindow) {
        this.keyboardWindow = null;
      }
    });
    keyboardWindow.on("move", () => {
      if (
        this.placementMode !== "floating" ||
        !this.keyboardWindow ||
        this.keyboardWindow.isDestroyed()
      ) {
        return;
      }

      this.floatingBounds = this.keyboardWindow.getBounds();
    });

    void keyboardWindow.loadFile(this.keyboardFrontendPath).catch((error) => {
      log.error("Failed to load keyboard window frontend:", error);
    });

    this.keyboardWindow = keyboardWindow;
    return keyboardWindow;
  }

  private isKeyboardVisible(): boolean {
    return (
      !!this.keyboardWindow &&
      !this.keyboardWindow.isDestroyed() &&
      this.keyboardWindow.isVisible()
    );
  }

  private calculateDockedKeyboardBounds(): ViewBounds {
    const contentBounds = this.mainWindow?.getContentBounds() ?? {
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    };
    return calculateDockedKeyboardBounds(contentBounds, this.workspaceBounds);
  }

  private calculateDefaultFloatingKeyboardBounds(): ViewBounds {
    const contentBounds = this.mainWindow?.getContentBounds() ?? {
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    };
    return calculateDefaultFloatingKeyboardBounds(
      contentBounds,
      this.workspaceBounds,
    );
  }

  private getKeyboardBounds(): ViewBounds {
    if (this.placementMode === "docked") {
      return this.calculateDockedKeyboardBounds();
    }

    return this.floatingBounds ?? this.calculateDefaultFloatingKeyboardBounds();
  }

  private getKeyboardInsetState(): EdenKeyboardInsetState {
    return {
      visible: this.isKeyboardVisible(),
      placementMode: this.placementMode,
      bottomInset:
        this.enabled &&
        this.placementMode === "docked" &&
        this.isKeyboardVisible()
          ? this.calculateDockedKeyboardBounds().height
          : 0,
    };
  }

  private getKeyboardLayout(target?: EdenKeyboardTarget): EdenKeyboardLayout {
    return calculateKeyboardLayout(target);
  }

  private getKeyboardState(): EdenKeyboardState {
    const insetState = this.getKeyboardInsetState();

    return {
      ...insetState,
      target: this.currentTarget?.target,
      layout: this.getKeyboardLayout(this.currentTarget?.target),
      enabled: this.enabled,
      showNumberRow: this.showNumberRow,
    };
  }

  private notifyKeyboardStateChanged(): void {
    const state = this.getKeyboardState();

    if (this.keyboardWindow && !this.keyboardWindow.isDestroyed()) {
      this.keyboardWindow.webContents.send(CHANNEL_STATE_CHANGED, state);
    }

    for (const [viewId] of this.viewManager.getAllViews()) {
      this.viewManager.sendToView(viewId, CHANNEL_STATE_CHANGED, state);
    }
  }

  private updateKeyboardWindowBounds(): void {
    if (!this.keyboardWindow || this.keyboardWindow.isDestroyed()) {
      return;
    }

    this.keyboardWindow.setBounds(this.getKeyboardBounds());
  }

  private updateWorkspacePresentation(): void {
    if (
      !this.enabled ||
      this.placementMode !== "docked" ||
      !this.isKeyboardVisible()
    ) {
      this.viewManager.setKeyboardPresentationLift(0);
      return;
    }

    const target = this.currentTarget;
    if (!target) {
      this.viewManager.setKeyboardPresentationLift(0);
      return;
    }

    const targetView = target
      ? this.viewManager.getViewInfo(target.viewId)
      : undefined;
    if (!targetView || targetView.viewType !== "app" || !targetView.visible) {
      this.viewManager.setKeyboardPresentationLift(0);
      return;
    }

    const contentBounds = this.mainWindow?.getContentBounds() ?? {
      x: 0,
      y: 0,
      width: 1280,
      height: 800,
    };
    const lift = calculateDockedKeyboardLift({
      keyboardHeight: this.calculateDockedKeyboardBounds().height,
      targetBounds: target.targetBounds,
      viewBounds: targetView.bounds,
      contentBounds,
    });

    this.viewManager.setKeyboardPresentationLift(lift);
  }

  private async refreshKeyboardPresentation(): Promise<void> {
    const keyboardWindow = this.ensureKeyboardWindow();
    if (keyboardWindow) {
      keyboardWindow.setMovable(this.placementMode === "floating");
      this.updateKeyboardWindowBounds();
    }

    this.updateWorkspacePresentation();
    this.notifyKeyboardStateChanged();
  }

  private async showKeyboard(): Promise<void> {
    const keyboardWindow = this.ensureKeyboardWindow();
    if (!keyboardWindow) {
      return;
    }

    if (!this.enabled) {
      this.updateWorkspacePresentation();
      this.notifyKeyboardStateChanged();
      return;
    }

    keyboardWindow.setMovable(this.placementMode === "floating");
    this.updateKeyboardWindowBounds();
    if (!keyboardWindow.isVisible()) {
      keyboardWindow.showInactive();
    }

    this.updateWorkspacePresentation();
    this.notifyKeyboardStateChanged();
  }

  private async hideKeyboard(): Promise<void> {
    if (!this.keyboardWindow || this.keyboardWindow.isDestroyed()) {
      this.updateWorkspacePresentation();
      return;
    }

    this.keyboardWindow.hide();
    this.updateWorkspacePresentation();
    this.notifyKeyboardStateChanged();
  }

  private destroyKeyboardWindow(): void {
    if (!this.keyboardWindow || this.keyboardWindow.isDestroyed()) {
      this.keyboardWindow = null;
      return;
    }

    this.keyboardWindow.close();
    this.keyboardWindow = null;
  }

  destroy(): void {
    ipcMain.removeHandler(CHANNEL_SEND_ACTION);
    ipcMain.removeHandler(CHANNEL_HIDE);
    ipcMain.removeAllListeners(CHANNEL_FOCUS_STATE);
    this.viewManager.setKeyboardPresentationLift(0);
    this.destroyKeyboardWindow();
  }

  private async initializeSettings(): Promise<void> {
    try {
      const [enabled, placementMode, showNumberRow] = await Promise.all([
        this.settingsManager.get(EDEN_SETTINGS_APP_ID, SETTING_ENABLED),
        this.settingsManager.get(EDEN_SETTINGS_APP_ID, SETTING_PLACEMENT_MODE),
        this.settingsManager.get(EDEN_SETTINGS_APP_ID, SETTING_SHOW_NUMBER_ROW),
      ]);

      this.enabled = enabled !== "false";
      this.placementMode = this.parsePlacementMode(placementMode);
      this.showNumberRow = showNumberRow !== "false";
      await this.refreshKeyboardPresentation();
    } catch (error) {
      log.error("Failed to initialize keyboard settings:", error);
    }
  }

  private parsePlacementMode(
    value: string | undefined,
  ): EdenKeyboardPlacementMode {
    return value === "floating" ? "floating" : DEFAULT_PLACEMENT_MODE;
  }
}

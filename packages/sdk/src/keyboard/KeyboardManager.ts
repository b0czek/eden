import * as fs from "node:fs";
import * as path from "node:path";
import type {
  EdenKeyboardAction,
  EdenKeyboardDragInput,
  EdenKeyboardDragPoint,
  EdenKeyboardFocusState,
  EdenKeyboardInsetState,
  EdenKeyboardLayout,
  EdenKeyboardPlacementMode,
  EdenKeyboardStartDragRequest,
  EdenKeyboardState,
  EdenKeyboardTarget,
  EdenKeyboardUpdateDragRequest,
  ViewBounds,
} from "@edenapp/types";
import { BrowserWindow, ipcMain, screen } from "electron";
import { delay, inject, injectable, singleton } from "tsyringe";
import { IPCBridge } from "../ipc";
import { log } from "../logging";
import { EDEN_SETTINGS_APP_ID, SettingsManager } from "../settings";
import { ViewManager } from "../view-manager";
import { MouseTracker } from "../view-manager/MouseTracker";
import {
  calculateDefaultFloatingKeyboardBounds,
  calculateDockedKeyboardBounds,
  calculateDockedKeyboardLift,
  calculateKeyboardLayout,
  KEYBOARD_COMPACT_DESIRED_WIDTH,
  KEYBOARD_COMPACT_MIN_WIDTH,
} from "./geometry";

const CHANNEL_FOCUS_STATE = "eden-keyboard:focus-state";
const CHANNEL_SHOW = "eden-keyboard:show";
const CHANNEL_SEND_ACTION = "eden-keyboard:send-action";
const CHANNEL_HIDE = "eden-keyboard:hide";
const CHANNEL_START_DRAG = "eden-keyboard:start-drag";
const CHANNEL_UPDATE_DRAG = "eden-keyboard:update-drag";
const CHANNEL_END_DRAG = "eden-keyboard:end-drag";
const CHANNEL_APPLY_ACTION = "eden-keyboard:apply-action";
const CHANNEL_STATE_CHANGED = "eden-keyboard:state-changed";
const CHANNEL_GET_STATE = "eden-keyboard:get-state";

const SETTING_ENABLED = "keyboard.enabled";
const SETTING_PLACEMENT_MODE = "keyboard.placementMode";
const SETTING_SHOW_NUMBER_ROW = "keyboard.showNumberRow";
const SETTING_INTERFACE_SCALE = "general.interfaceScale";
const DEFAULT_ENABLED = true;
const DEFAULT_PLACEMENT_MODE: EdenKeyboardPlacementMode = "docked";
const DEFAULT_SHOW_NUMBER_ROW = true;
const DEFAULT_INTERFACE_SCALE = 1;

type KeyboardTargetSession = {
  appId: string;
  viewId: number;
  sessionId: number;
  target?: EdenKeyboardTarget;
  targetBounds?: EdenKeyboardFocusState["targetBounds"];
  placementMode?: EdenKeyboardPlacementMode;
};

type KeyboardDragState = {
  input: EdenKeyboardDragInput;
  startPoint: { x: number; y: number };
  startBounds: ViewBounds;
  lastX?: number;
  lastY?: number;
};

@singleton()
@injectable()
export class KeyboardManager {
  private mainWindow: BrowserWindow | null = null;
  private keyboardWindow: BrowserWindow | null = null;
  private workspaceBounds: ViewBounds | null = null;
  private currentTarget: KeyboardTargetSession | null = null;
  private persistentVisibility = false;
  private dismissedTarget: Pick<
    KeyboardTargetSession,
    "viewId" | "sessionId"
  > | null = null;
  private floatingBounds: ViewBounds | null = null;
  private enabled = DEFAULT_ENABLED;
  private placementMode: EdenKeyboardPlacementMode = DEFAULT_PLACEMENT_MODE;
  private showNumberRow = DEFAULT_SHOW_NUMBER_ROW;
  private interfaceScale = DEFAULT_INTERFACE_SCALE;
  private dragState: KeyboardDragState | null = null;
  private readonly mouseTracker = new MouseTracker(8);
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
        if (
          this.isKeyboardVisible() &&
          this.getEffectivePlacementMode() === "docked"
        ) {
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
          if (this.persistentVisibility) {
            void this.refreshKeyboardPresentation();
            return;
          }

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
          void this.refreshKeyboardPresentation();
          return;
        }

        if (data.key === SETTING_INTERFACE_SCALE) {
          const nextScale = this.parseInterfaceScale(data.value);
          if (nextScale === this.interfaceScale) {
            return;
          }

          this.interfaceScale = nextScale;
          this.applyKeyboardWindowScale();
          void this.refreshKeyboardPresentation();
          return;
        }

        if (data.key === SETTING_ENABLED) {
          const nextEnabled = data.value !== "false";
          if (nextEnabled === this.enabled) {
            return;
          }

          this.enabled = nextEnabled;
          if (!this.enabled) {
            this.persistentVisibility = false;
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

    ipcMain.handle(
      CHANNEL_START_DRAG,
      async (event, payload: EdenKeyboardStartDragRequest | undefined) => {
        return await this.handleStartDragRequest(event.sender.id, payload);
      },
    );

    ipcMain.on(
      CHANNEL_UPDATE_DRAG,
      (event, payload: EdenKeyboardUpdateDragRequest | undefined) => {
        this.handleUpdateDragRequest(event.sender.id, payload);
      },
    );

    ipcMain.handle(CHANNEL_END_DRAG, async (event) => {
      return await this.handleEndDragRequest(event.sender.id);
    });

    ipcMain.handle(CHANNEL_GET_STATE, async () => {
      return this.getKeyboardState();
    });
  }

  private attachMainWindowTracking(window: BrowserWindow): void {
    window.on("move", () => {
      if (
        this.isKeyboardVisible() &&
        this.getEffectivePlacementMode() === "docked"
      ) {
        void this.refreshKeyboardPresentation();
      }
    });

    window.on("resize", () => {
      if (
        this.isKeyboardVisible() &&
        this.getEffectivePlacementMode() === "docked"
      ) {
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
      if (this.currentTarget?.viewId === viewId) {
        this.currentTarget = null;
        if (this.persistentVisibility) {
          void this.refreshKeyboardPresentation();
          return;
        }

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
      placementMode: payload.placementMode,
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
    if (
      this.isKeyboardVisible() &&
      this.placementMode === "docked" &&
      this.keyboardWindow &&
      !this.keyboardWindow.isDestroyed()
    ) {
      this.floatingBounds = this.keyboardWindow.getBounds();
    }

    this.persistentVisibility = true;
    this.dismissedTarget = null;
    await this.showKeyboard();
    return { success: true };
  }

  private async handleHideRequest(
    _senderWebContentsId: number,
  ): Promise<{ success: boolean }> {
    this.persistentVisibility = false;
    if (this.currentTarget) {
      this.dismissedTarget = {
        viewId: this.currentTarget.viewId,
        sessionId: this.currentTarget.sessionId,
      };
    }

    await this.hideKeyboard();
    return { success: true };
  }

  private ensureKeyboardRequest(senderWebContentsId: number): boolean {
    return senderWebContentsId === this.keyboardWindow?.webContents.id;
  }

  private async handleStartDragRequest(
    senderWebContentsId: number,
    payload: EdenKeyboardStartDragRequest | undefined,
  ): Promise<{ success: boolean }> {
    if (!this.ensureKeyboardRequest(senderWebContentsId)) {
      throw new Error("Only the keyboard window can start keyboard drag");
    }

    if (
      this.getEffectivePlacementMode() !== "floating" ||
      !this.keyboardWindow ||
      this.keyboardWindow.isDestroyed() ||
      !payload ||
      !this.isValidDragInput(payload.input) ||
      !this.isValidDragPoint(payload.point)
    ) {
      return { success: false };
    }

    const startPoint = this.resolveDragPoint(payload.point);

    this.endKeyboardDrag();
    this.dragState = {
      input: payload.input,
      startPoint,
      startBounds: this.keyboardWindow.getBounds(),
    };

    if (payload.input === "system-cursor") {
      this.mouseTracker.subscribe("keyboard-drag", (position) => {
        this.applyKeyboardDragPosition(position.x, position.y);
      });
    }

    return { success: true };
  }

  private handleUpdateDragRequest(
    senderWebContentsId: number,
    payload: EdenKeyboardUpdateDragRequest | undefined,
  ): void {
    if (!this.ensureKeyboardRequest(senderWebContentsId)) {
      return;
    }

    if (!this.dragState || !payload || !this.isValidDragPoint(payload.point)) {
      return;
    }

    if (this.dragState.input !== "renderer-events") {
      return;
    }

    const point = this.resolveDragPoint(payload.point);
    this.applyKeyboardDragPosition(point.x, point.y);
  }

  private isValidDragInput(
    input: EdenKeyboardStartDragRequest["input"] | undefined,
  ): input is EdenKeyboardDragInput {
    return input === "system-cursor" || input === "renderer-events";
  }

  private isValidDragPoint(
    point: EdenKeyboardStartDragRequest["point"] | undefined,
  ): point is EdenKeyboardDragPoint {
    if (
      !point ||
      typeof point.x !== "number" ||
      typeof point.y !== "number" ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y)
    ) {
      return false;
    }

    return point.space === "screen" || point.space === "keyboard-client";
  }

  private resolveDragPoint(point: EdenKeyboardDragPoint): {
    x: number;
    y: number;
  } {
    if (point.space === "screen") {
      return { x: point.x, y: point.y };
    }

    if (!this.keyboardWindow || this.keyboardWindow.isDestroyed()) {
      return { x: point.x, y: point.y };
    }

    const bounds = this.keyboardWindow.getBounds();
    return {
      x: bounds.x + Math.round(point.x * this.interfaceScale),
      y: bounds.y + Math.round(point.y * this.interfaceScale),
    };
  }

  private applyKeyboardDragPosition(screenX: number, screenY: number): void {
    if (
      !this.dragState ||
      !this.keyboardWindow ||
      this.keyboardWindow.isDestroyed()
    ) {
      return;
    }

    const nextBounds = {
      ...this.dragState.startBounds,
      x: Math.round(
        this.dragState.startBounds.x + screenX - this.dragState.startPoint.x,
      ),
      y: Math.round(
        this.dragState.startBounds.y + screenY - this.dragState.startPoint.y,
      ),
    };
    const constrainedBounds = this.constrainFloatingBounds(nextBounds);
    const nextX = constrainedBounds.x;
    const nextY = constrainedBounds.y;

    if (this.dragState.lastX === nextX && this.dragState.lastY === nextY) {
      return;
    }

    this.dragState.lastX = nextX;
    this.dragState.lastY = nextY;
    this.keyboardWindow.setBounds(constrainedBounds);
    this.floatingBounds = constrainedBounds;
  }

  private constrainFloatingBounds(bounds: ViewBounds): ViewBounds {
    const display = screen.getDisplayMatching(bounds);
    const area = display.workArea;
    const maxX = area.x + Math.max(0, area.width - bounds.width);
    const maxY = area.y + Math.max(0, area.height - bounds.height);

    return {
      ...bounds,
      x: Math.min(Math.max(bounds.x, area.x), maxX),
      y: Math.min(Math.max(bounds.y, area.y), maxY),
    };
  }

  private async handleEndDragRequest(
    senderWebContentsId: number,
  ): Promise<{ success: boolean }> {
    if (!this.ensureKeyboardRequest(senderWebContentsId)) {
      throw new Error("Only the keyboard window can end keyboard drag");
    }

    this.endKeyboardDrag();
    return { success: true };
  }

  private endKeyboardDrag(): void {
    this.mouseTracker.unsubscribe("keyboard-drag");

    if (
      this.dragState &&
      this.keyboardWindow &&
      !this.keyboardWindow.isDestroyed()
    ) {
      this.floatingBounds = this.keyboardWindow.getBounds();
    }

    this.dragState = null;
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
    keyboardWindow.webContents.setZoomFactor(this.interfaceScale);
    keyboardWindow.setMovable(this.getEffectivePlacementMode() === "floating");
    keyboardWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    keyboardWindow.webContents.on("did-finish-load", () => {
      this.notifyKeyboardStateChanged();
    });
    keyboardWindow.on("closed", () => {
      if (this.keyboardWindow === keyboardWindow) {
        this.endKeyboardDrag();
        this.keyboardWindow = null;
      }
    });
    keyboardWindow.on("move", () => {
      if (
        this.dragState ||
        this.getEffectivePlacementMode() !== "floating" ||
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
    return calculateDockedKeyboardBounds(
      contentBounds,
      this.workspaceBounds,
      this.getKeyboardGeometryOptions(),
    );
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
      this.getKeyboardGeometryOptions(),
    );
  }

  private getEffectivePlacementMode(): EdenKeyboardPlacementMode {
    if (this.persistentVisibility) {
      return "floating";
    }

    if (this.currentTarget?.placementMode) {
      return this.currentTarget.placementMode;
    }

    return this.placementMode;
  }

  private getKeyboardBounds(): ViewBounds {
    if (this.getEffectivePlacementMode() === "docked") {
      return this.calculateDockedKeyboardBounds();
    }

    const defaultBounds = this.calculateDefaultFloatingKeyboardBounds();
    if (!this.floatingBounds) {
      return defaultBounds;
    }

    return {
      ...this.floatingBounds,
      width: defaultBounds.width,
      height: defaultBounds.height,
    };
  }

  private getKeyboardInsetState(): EdenKeyboardInsetState {
    const placementMode = this.getEffectivePlacementMode();

    return {
      visible: this.isKeyboardVisible(),
      placementMode,
      bottomInset:
        this.enabled && placementMode === "docked" && this.isKeyboardVisible()
          ? this.calculateDockedKeyboardBounds().height
          : 0,
    };
  }

  private getKeyboardLayout(target?: EdenKeyboardTarget): EdenKeyboardLayout {
    return calculateKeyboardLayout(target);
  }

  private getKeyboardRowCount(): number {
    const layout = this.getKeyboardLayout(this.currentTarget?.target);
    if (layout === "number") {
      return 4;
    }

    return this.showNumberRow ? 5 : 4;
  }

  private getKeyboardGeometryOptions(): {
    rowCount: number;
    scale: number;
    desiredWidth?: number;
    minWidth?: number;
  } {
    const layout = this.getKeyboardLayout(this.currentTarget?.target);
    const isCompactLayout = layout === "number";

    return {
      rowCount: this.getKeyboardRowCount(),
      scale: this.interfaceScale,
      ...(isCompactLayout
        ? {
            desiredWidth: KEYBOARD_COMPACT_DESIRED_WIDTH,
            minWidth: KEYBOARD_COMPACT_MIN_WIDTH,
          }
        : {}),
    };
  }

  private applyKeyboardWindowScale(): void {
    if (!this.keyboardWindow || this.keyboardWindow.isDestroyed()) {
      return;
    }

    this.keyboardWindow.webContents.setZoomFactor(this.interfaceScale);
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
      this.getEffectivePlacementMode() !== "docked" ||
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
      keyboardWindow.setMovable(
        this.getEffectivePlacementMode() === "floating",
      );
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

    keyboardWindow.setMovable(this.getEffectivePlacementMode() === "floating");
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
    ipcMain.removeHandler(CHANNEL_START_DRAG);
    ipcMain.removeAllListeners(CHANNEL_UPDATE_DRAG);
    ipcMain.removeHandler(CHANNEL_END_DRAG);
    ipcMain.removeAllListeners(CHANNEL_FOCUS_STATE);
    this.endKeyboardDrag();
    this.mouseTracker.dispose();
    this.viewManager.setKeyboardPresentationLift(0);
    this.destroyKeyboardWindow();
  }

  private async initializeSettings(): Promise<void> {
    try {
      const [enabled, placementMode, showNumberRow, interfaceScale] =
        await Promise.all([
          this.settingsManager.get(EDEN_SETTINGS_APP_ID, SETTING_ENABLED),
          this.settingsManager.get(
            EDEN_SETTINGS_APP_ID,
            SETTING_PLACEMENT_MODE,
          ),
          this.settingsManager.get(
            EDEN_SETTINGS_APP_ID,
            SETTING_SHOW_NUMBER_ROW,
          ),
          this.settingsManager.get(
            EDEN_SETTINGS_APP_ID,
            SETTING_INTERFACE_SCALE,
          ),
        ]);

      this.enabled = enabled !== "false";
      this.placementMode = this.parsePlacementMode(placementMode);
      this.showNumberRow = showNumberRow !== "false";
      this.interfaceScale = this.parseInterfaceScale(interfaceScale);
      this.applyKeyboardWindowScale();
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

  private parseInterfaceScale(value: string | undefined): number {
    const scale = Number.parseFloat(value ?? "");
    if (!Number.isFinite(scale)) {
      return DEFAULT_INTERFACE_SCALE;
    }

    return Math.max(0.5, Math.min(scale, 2));
  }
}

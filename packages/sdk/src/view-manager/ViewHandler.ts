import type {
  TileLayoutDirection,
  TileLayoutState,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import { EdenHandler, EdenNamespace } from "../ipc";
import { log } from "../logging";
import type { DisplayPort } from "../platform/ports";
import { MouseTracker } from "./MouseTracker";
import {
  calculateResizeBounds,
  type ResizeConstraints,
  type ResizeDirection,
} from "./resize-geometry";
import type { ViewManager } from "./ViewManager";

@EdenNamespace("view")
export class ViewHandler {
  private viewManager: ViewManager;
  private mouseTracker: MouseTracker;

  // Global drag/resize tracking
  private dragState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: ViewBounds;
  } | null = null;

  private resizeState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: ViewBounds;
    direction: ResizeDirection;
    constraints: ResizeConstraints;
  } | null = null;

  // We need a way to get running app instances to map appId to viewId
  // Or we can ask ViewManager to find views by appId.
  // ViewManager has getViewsByAppId(appId).

  constructor(viewManager: ViewManager, display: DisplayPort) {
    this.viewManager = viewManager;
    this.mouseTracker = new MouseTracker(display, 8); // ~120fps
  }

  private requireCallerAppId(callerAppId?: string): string {
    if (!callerAppId) {
      throw new Error("Caller app context is required for this endpoint");
    }
    return callerAppId;
  }

  private getViewIdByAppId(appId: string): number {
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    return viewIds[0];
  }

  private startDragForApp(appId: string, startX: number, startY: number): void {
    const viewId = this.getViewIdByAppId(appId);

    // Get current view bounds
    const viewInfo = this.viewManager.getViewInfo(viewId);
    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    // Stop any existing drag
    if (this.dragState) {
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
    }

    // Start tracking global mouse position
    this.dragState = {
      appId,
      startX,
      startY,
      startBounds: { ...viewInfo.bounds },
    };

    // Subscribe to mouse updates
    this.mouseTracker.subscribe(`drag-${appId}`, (position) => {
      if (!this.dragState) return;

      const deltaX = position.x - this.dragState.startX;
      const deltaY = position.y - this.dragState.startY;

      const newBounds = {
        x: this.dragState.startBounds.x + deltaX,
        y: this.dragState.startBounds.y + deltaY,
        width: this.dragState.startBounds.width,
        height: this.dragState.startBounds.height,
      };

      this.viewManager.setViewBounds(viewId, newBounds, { notify: true });
    });
  }

  private endDragForApp(appId?: string): void {
    if (!this.dragState) {
      return;
    }
    if (appId && this.dragState.appId !== appId) {
      throw new Error("Drag state does not belong to caller");
    }
    this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
    this.dragState = null;
  }

  private startResizeForApp(
    appId: string,
    startX: number,
    startY: number,
    direction: ResizeDirection,
  ): void {
    const viewId = this.getViewIdByAppId(appId);

    // Get current view bounds
    const viewInfo = this.viewManager.getViewInfo(viewId);
    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    // Stop any existing resize
    if (this.resizeState) {
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
    }

    const interfaceScale =
      viewInfo.manifest.window?.scaling === "manual"
        ? 1
        : this.viewManager.getCurrentScale();
    const windowConfig = viewInfo.manifest.window;
    const scaled = (value: number) => Math.round(value * interfaceScale);

    // Initialize resize state
    this.resizeState = {
      appId,
      startX,
      startY,
      startBounds: { ...viewInfo.bounds },
      direction,
      constraints: {
        minWidth: scaled(windowConfig?.minSize?.width || 200),
        minHeight: scaled(windowConfig?.minSize?.height || 200),
        maxWidth: windowConfig?.maxSize?.width
          ? scaled(windowConfig.maxSize.width)
          : undefined,
        maxHeight: windowConfig?.maxSize?.height
          ? scaled(windowConfig.maxSize.height)
          : undefined,
      },
    };

    // Subscribe to mouse updates
    this.mouseTracker.subscribe(`resize-${appId}`, (position) => {
      if (!this.resizeState) return;

      const deltaX = position.x - this.resizeState.startX;
      const deltaY = position.y - this.resizeState.startY;

      const newBounds = calculateResizeBounds(
        this.resizeState.startBounds,
        deltaX,
        deltaY,
        this.resizeState.direction,
        this.resizeState.constraints,
      );

      this.viewManager.setViewBounds(viewId, newBounds, { notify: true });
    });
  }

  private endResizeForApp(appId?: string): void {
    if (!this.resizeState) {
      return;
    }
    if (appId && this.resizeState.appId !== appId) {
      throw new Error("Resize state does not belong to caller");
    }
    this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
    this.resizeState = null;
  }

  /**
   * Update bounds for the caller's own view.
   */
  @EdenHandler("update-bounds")
  async handleUpdateOwnViewBounds(args: {
    bounds: ViewBounds;
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    const viewId = this.getViewIdByAppId(appId);
    this.viewManager.setViewBounds(viewId, args.bounds, { notify: true });
    return { success: true };
  }

  /**
   * Update bounds for any app view.
   * Requires "view/manage" permission.
   */
  @EdenHandler("update-view-bounds", { permission: "manage" })
  async handleUpdateManagedViewBounds(args: {
    appId: string;
    bounds: ViewBounds;
  }): Promise<{ success: boolean }> {
    const viewId = this.getViewIdByAppId(args.appId);
    this.viewManager.setViewBounds(viewId, args.bounds);
    return { success: true };
  }

  /**
   * Show or hide the caller's own view.
   */
  @EdenHandler("set-visibility")
  async handleSetOwnViewVisibility(args: {
    visible: boolean;
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    const viewId = this.getViewIdByAppId(appId);
    if (args.visible) {
      this.viewManager.showView(viewId);
    } else {
      this.viewManager.hideView(viewId);
    }
    return { success: true };
  }

  /**
   * Show or hide any app view.
   * Requires "view/manage" permission.
   */
  @EdenHandler("set-view-visibility", { permission: "manage" })
  async handleSetManagedViewVisibility(args: {
    appId: string;
    visible: boolean;
  }): Promise<{ success: boolean }> {
    const viewId = this.getViewIdByAppId(args.appId);
    if (args.visible) {
      this.viewManager.showView(viewId);
    } else {
      this.viewManager.hideView(viewId);
    }
    return { success: true };
  }

  /**
   * Bring caller's own view to the front and focus it.
   */
  @EdenHandler("focus")
  async handleFocusOwnApp(args: {
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    const viewId = this.getViewIdByAppId(appId);
    this.viewManager.showView(viewId);
    this.viewManager.focusView(viewId);
    return { success: true };
  }

  /**
   * Bring any app view to the front and focus it.
   * Requires "view/manage" permission.
   */
  @EdenHandler("focus-view", { permission: "manage" })
  async handleFocusManagedApp(args: {
    appId: string;
  }): Promise<{ success: boolean }> {
    const viewId = this.getViewIdByAppId(args.appId);
    this.viewManager.showView(viewId);
    this.viewManager.focusView(viewId);
    return { success: true };
  }

  /**
   * Update the available workspace bounds (e.g. after taskbar resize).
   * Requires "view/manage" permission for app callers.
   */
  @EdenHandler("update-global-bounds", { permission: "manage" })
  async handleUpdateWorkspaceBounds(args: {
    bounds: ViewBounds;
    windowSize: WindowSize;
  }): Promise<{ success: boolean }> {
    const { bounds, windowSize } = args;

    this.viewManager.updateGlobalBounds(bounds, windowSize);

    return { success: true };
  }

  /**
   * Toggle caller's own view between floating and tiled window modes.
   */
  @EdenHandler("toggle-mode")
  async handleToggleOwnViewMode(args: {
    mode?: "floating" | "tiled";
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    const viewId = this.getViewIdByAppId(appId);
    this.viewManager.setViewMode(viewId, args.mode);
    return { success: true };
  }

  /**
   * Toggle any app view between floating and tiled window modes.
   * Requires "view/manage" permission.
   */
  @EdenHandler("toggle-view-mode", { permission: "manage" })
  async handleToggleManagedViewMode(args: {
    appId: string;
    mode?: "floating" | "tiled";
  }): Promise<{ success: boolean }> {
    const viewId = this.getViewIdByAppId(args.appId);
    this.viewManager.setViewMode(viewId, args.mode);
    return { success: true };
  }

  /**
   * Get adjacent tiled windows for the caller's app-frame layout controls.
   */
  @EdenHandler("tile-layout-state")
  async handleTileLayoutState(args: {
    _callerAppId?: string;
  }): Promise<TileLayoutState> {
    const appId = this.requireCallerAppId(args._callerAppId);
    return this.viewManager.getTileLayoutState(this.getViewIdByAppId(appId));
  }

  /** Swap the caller with the tiled window on one edge. */
  @EdenHandler("swap-tile")
  async handleSwapTile(args: {
    direction: TileLayoutDirection;
    _callerAppId?: string;
  }): Promise<TileLayoutState> {
    const appId = this.requireCallerAppId(args._callerAppId);
    return this.viewManager.swapTiledView(
      this.getViewIdByAppId(appId),
      args.direction,
    );
  }

  /** Temporarily cover the tiled window on one edge with the caller. */
  @EdenHandler("expand-tile")
  async handleExpandTile(args: {
    direction: TileLayoutDirection;
    _callerAppId?: string;
  }): Promise<TileLayoutState> {
    const appId = this.requireCallerAppId(args._callerAppId);
    return this.viewManager.expandTiledView(
      this.getViewIdByAppId(appId),
      args.direction,
    );
  }

  /**
   * Start dragging caller's own view.
   */
  @EdenHandler("start-drag")
  async handleStartOwnDrag(args: {
    startX: number;
    startY: number;
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    this.startDragForApp(appId, args.startX, args.startY);
    return { success: true };
  }

  /**
   * End drag operation for caller's own view.
   */
  @EdenHandler("end-drag")
  async handleEndOwnDrag(args: {
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    this.endDragForApp(appId);
    return { success: true };
  }

  /**
   * Handle global mouse up event to stop any active drag/resize operations.
   * Requires "view/manage" permission for app callers.
   */
  @EdenHandler("global-mouseup", { permission: "manage" })
  async handleGlobalMouseUp(): Promise<{ success: boolean }> {
    // Cleanup any active drag or resize operations when mouse is released
    if (this.dragState) {
      log.info("Global mouseup - cleaning up drag state");
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
      this.dragState = null;
    }
    if (this.resizeState) {
      log.info("Global mouseup - cleaning up resize state");
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
      this.resizeState = null;
    }
    return { success: true };
  }

  /**
   * Start resizing caller's own view.
   */
  @EdenHandler("start-resize")
  async handleStartOwnResize(args: {
    startX: number;
    startY: number;
    direction?: "left" | "right" | "bottom" | "bottom-left" | "bottom-right";
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    this.startResizeForApp(
      appId,
      args.startX,
      args.startY,
      args.direction ?? "bottom-right",
    );
    return { success: true };
  }

  /**
   * End resize operation for caller's own view.
   */
  @EdenHandler("end-resize")
  async handleEndOwnResize(args: {
    _callerAppId?: string;
  }): Promise<{ success: boolean }> {
    const appId = this.requireCallerAppId(args._callerAppId);
    this.endResizeForApp(appId);
    return { success: true };
  }

  /**
   * Get the current dimensions of the main window.
   */
  @EdenHandler("window-size")
  async handleGetWindowSize(): Promise<WindowSize> {
    return this.viewManager.getWindowSize();
  }

  // ===================================================================
  // Interface Scale Handlers
  // ===================================================================

  /**
   * Set the interface scale (zoom factor) for all views.
   * @param scale - Scale factor as a string (e.g., "1.0" for 100%, "1.5" for 150%)
   */
  @EdenHandler("set-interface-scale")
  async handleSetInterfaceScale(args: {
    scale: string;
  }): Promise<{ success: boolean }> {
    const scaleNum = parseFloat(args.scale);
    if (Number.isNaN(scaleNum)) {
      throw new Error(`Invalid scale value: ${args.scale}`);
    }
    this.viewManager.setInterfaceScale(scaleNum);
    return { success: true };
  }

  /**
   * Get the current interface scale.
   */
  @EdenHandler("get-interface-scale")
  async handleGetInterfaceScale(): Promise<{ scale: number }> {
    return { scale: this.viewManager.getCurrentScale() };
  }

  dispose(): void {
    this.dragState = null;
    this.resizeState = null;
    this.mouseTracker.dispose();
  }
}

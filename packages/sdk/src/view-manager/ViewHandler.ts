import { EdenHandler, EdenNamespace, IPCBridge, EdenEmitter } from "../ipc";
import { ViewManager } from "./ViewManager";
import { MouseTracker } from "./MouseTracker";
import { AppInstance, ViewBounds, WindowSize } from "@edenapp/types";

/**
 * Events emitted by the ViewHandler
 */
interface ViewHandlerEvents {
  "bounds-updated": ViewBounds;
  "global-bounds-changed": {
    workspaceBounds: ViewBounds;
    windowSize: WindowSize;
  };
}

@EdenNamespace("view")
export class ViewHandler extends EdenEmitter<ViewHandlerEvents> {
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
    currentWidth: number;
    currentHeight: number;
  } | null = null;

  // We need a way to get running app instances to map appId to viewId
  // Or we can ask ViewManager to find views by appId.
  // ViewManager has getViewsByAppId(appId).

  constructor(viewManager: ViewManager, ipcBridge: IPCBridge) {
    super(ipcBridge);
    this.viewManager = viewManager;
    this.mouseTracker = new MouseTracker(8); // ~120fps
  }

  /**
   * Update the bounds (position and size) of a specific view.
   */
  @EdenHandler("update-view-bounds")
  async handleUpdateViewBounds(args: {
    appId: string;
    bounds: ViewBounds;
  }): Promise<{ success: boolean }> {
    const { appId, bounds } = args;

    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length > 0) {
      // Use the first view (typically there's only one per appId)
      this.viewManager.setViewBounds(viewIds[0], bounds);
      return { success: true };
    }

    throw new Error(`App or view ${appId} is not running`);
  }

  /**
   * Show or hide a specific view.
   */
  @EdenHandler("set-view-visibility")
  async handleSetViewVisibility(args: {
    appId: string;
    visible: boolean;
  }): Promise<{ success: boolean }> {
    const { appId, visible } = args;
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }

    if (visible) {
      this.viewManager.showView(viewIds[0]);
    } else {
      this.viewManager.hideView(viewIds[0]);
    }
    return { success: true };
  }

  /**
   * Bring an application's view to the front and focus it.
   */
  @EdenHandler("focus-app")
  async handleFocusApp(args: { appId: string }): Promise<{ success: boolean }> {
    const { appId } = args;
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    this.viewManager.showView(viewIds[0]);
    this.viewManager.focusView(viewIds[0]);
    return { success: true };
  }

  /**
   * Update the available workspace bounds (e.g. after taskbar resize).
   */
  @EdenHandler("update-global-bounds")
  async handleUpdateWorkspaceBounds(args: {
    bounds: ViewBounds;
    windowSize: WindowSize;
  }): Promise<{ success: boolean }> {
    const { bounds, windowSize } = args;

    this.viewManager.setWorkspaceBounds(bounds);

    this.viewManager.setWindowSize(windowSize);

    this.notify("global-bounds-changed", {
      workspaceBounds: bounds,
      windowSize,
    });

    return { success: true };
  }

  /**
   * Toggle between floating and tiled window modes.
   */
  @EdenHandler("toggle-view-mode")
  async handleToggleViewMode(args: {
    appId: string;
    mode?: "floating" | "tiled";
  }): Promise<{ success: boolean }> {
    const { appId, mode } = args;

    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }

    this.viewManager.setViewMode(viewIds[0], mode);
    return { success: true };
  }

  /**
   * Start dragging a window.
   */
  @EdenHandler("start-drag")
  async handleStartDrag(args: {
    appId: string;
    startX: number;
    startY: number;
  }): Promise<{ success: boolean }> {
    const { appId, startX, startY } = args;
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    const viewId = viewIds[0];

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

      this.viewManager.setViewBounds(viewId, newBounds);
      this.notifySubscriber(viewId, "bounds-updated", newBounds);
    });

    return { success: true };
  }

  /**
   * End the current drag operation.
   */
  @EdenHandler("end-drag")
  async handleEndDrag(args: { appId: string }): Promise<{ success: boolean }> {
    if (this.dragState) {
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
      this.dragState = null;
    }
    return { success: true };
  }

  /**
   * Handle global mouse up event to stop any active drag/resize operations.
   */
  @EdenHandler("global-mouseup")
  async handleGlobalMouseUp(): Promise<{ success: boolean }> {
    // Cleanup any active drag or resize operations when mouse is released
    if (this.dragState) {
      console.log("[ViewHandler] Global mouseup - cleaning up drag state");
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
      this.dragState = null;
    }
    if (this.resizeState) {
      console.log("[ViewHandler] Global mouseup - cleaning up resize state");
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
      this.resizeState = null;
    }
    return { success: true };
  }

  /**
   * Start resizing a window.
   */
  @EdenHandler("start-resize")
  async handleStartResize(args: {
    appId: string;
    startX: number;
    startY: number;
  }): Promise<{ success: boolean }> {
    const { appId, startX, startY } = args;
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    const viewId = viewIds[0];

    // Get current view bounds
    const viewInfo = this.viewManager.getViewInfo(viewId);
    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    // Stop any existing resize
    if (this.resizeState) {
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
    }

    // Initialize resize state
    this.resizeState = {
      appId,
      startX,
      startY,
      startBounds: { ...viewInfo.bounds },
      currentWidth: viewInfo.bounds.width,
      currentHeight: viewInfo.bounds.height,
    };

    // Subscribe to mouse updates
    this.mouseTracker.subscribe(`resize-${appId}`, (position) => {
      if (!this.resizeState) return;

      const deltaX = position.x - this.resizeState.startX;
      const deltaY = position.y - this.resizeState.startY;

      let targetWidth = this.resizeState.startBounds.width + deltaX;
      let targetHeight = this.resizeState.startBounds.height + deltaY;

      // Apply minimum size
      targetWidth = Math.max(targetWidth, 200);
      targetHeight = Math.max(targetHeight, 200);

      this.resizeState.currentWidth = targetWidth;
      this.resizeState.currentHeight = targetHeight;

      const newBounds = {
        x: this.resizeState.startBounds.x,
        y: this.resizeState.startBounds.y,
        width: Math.round(this.resizeState.currentWidth),
        height: Math.round(this.resizeState.currentHeight),
      };

      this.viewManager.setViewBounds(viewId, newBounds);
      this.notifySubscriber(viewId, "bounds-updated", newBounds);
    });

    return { success: true };
  }

  /**
   * End the current resize operation.
   */
  @EdenHandler("end-resize")
  async handleEndResize(args: {
    appId: string;
  }): Promise<{ success: boolean }> {
    if (this.resizeState) {
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
      this.resizeState = null;
    }
    return { success: true };
  }

  /**
   * Get the current dimensions of the main window.
   */
  @EdenHandler("window-size")
  async handleGetWindowSize(): Promise<WindowSize> {
    return this.viewManager.getWindowSize();
  }
}

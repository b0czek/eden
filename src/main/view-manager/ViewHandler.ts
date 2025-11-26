import { CommandHandler, CommandNamespace } from "../ipc/CommandDecorators";
import { ViewManager } from "./ViewManager";
import { IPCBridge } from "../ipc/IPCBridge";
import { MouseTracker } from "./MouseTracker";
import { AppInstance } from "../../types";

@CommandNamespace("view")
export class ViewHandler {
  private viewManager: ViewManager;
  private ipcBridge: IPCBridge;
  private mouseTracker: MouseTracker;
  
  // Global drag/resize tracking
  private dragState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: { x: number; y: number; width: number; height: number };
  } | null = null;

  private resizeState: {
    appId: string;
    startX: number;
    startY: number;
    startBounds: { x: number; y: number; width: number; height: number };
    currentWidth: number;
    currentHeight: number;
  } | null = null;

  // We need a way to get running app instances to map appId to viewId
  // Or we can ask ViewManager to find views by appId.
  // ViewManager has getViewsByAppId(appId).

  constructor(
    viewManager: ViewManager,
    ipcBridge: IPCBridge
  ) {
    this.viewManager = viewManager;
    this.ipcBridge = ipcBridge;
    this.mouseTracker = new MouseTracker(8); // ~120fps
  }

  @CommandHandler("update-view-bounds")
  async handleUpdateViewBounds(
    args: { appId: string; bounds: { x: number; y: number; width: number; height: number } }
  ): Promise<any> {
    const { appId, bounds } = args;
    
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length > 0) {
      // Use the first view (typically there's only one per appId)
      const success = this.viewManager.setViewBounds(viewIds[0], bounds);
      return { success };
    }
    
    throw new Error(`App or view ${appId} is not running`);
  }

  @CommandHandler("set-view-visibility")
  async handleSetViewVisibility(
    args: { appId: string; visible: boolean }
  ): Promise<any> {
    const { appId, visible } = args;
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    
    const success = visible
      ? this.viewManager.showView(viewIds[0])
      : this.viewManager.hideView(viewIds[0]);
    return { success };
  }

  @CommandHandler("focus-app")
  async handleFocusApp(
    args: { appId: string }
  ): Promise<any> {
    const { appId } = args;
    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    const success = this.viewManager.bringToFront(viewIds[0]);
    return { success };
  }

  @CommandHandler("update-workspace-bounds")
  async handleUpdateWorkspaceBounds(
    args: { bounds: { x: number; y: number; width: number; height: number } }
  ): Promise<any> {
    const { bounds } = args;

    this.viewManager.setWorkspaceBounds(bounds);
    
    this.ipcBridge.eventSubscribers.notify("view/workspace-bounds-changed", {
      bounds,
    });


    return { success: true };
  }

  @CommandHandler("toggle-view-mode")
  async handleToggleViewMode(
    args: { appId: string; mode?: "floating" | "tiled" }
  ): Promise<any> {
    const { appId, mode } = args;

    const viewIds = this.viewManager.getViewsByAppId(appId);
    if (viewIds.length === 0) {
      throw new Error(`App ${appId} is not running`);
    }
    
    const success = this.viewManager.setViewMode(viewIds[0], mode);
    return { success };
  }

  @CommandHandler("start-drag")
  async handleStartDrag(
    args: { appId: string; startX: number; startY: number }
  ): Promise<any> {
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
      this.ipcBridge.eventSubscribers.notifyView(viewId, "view/bounds-updated", newBounds);

    });

    return { success: true };
  }

  @CommandHandler("end-drag")
  async handleEndDrag(
    args: { appId: string }
  ): Promise<any> {
    if (this.dragState) {
      this.mouseTracker.unsubscribe(`drag-${this.dragState.appId}`);
      this.dragState = null;
    }
    return { success: true };
  }

  @CommandHandler("global-mouseup")
  async handleGlobalMouseUp(): Promise<any> {
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

  @CommandHandler("start-resize")
  async handleStartResize(
    args: { appId: string; startX: number; startY: number }
  ): Promise<any> {
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
      this.ipcBridge.eventSubscribers.notifyView(viewId, "view/bounds-updated", newBounds);

    });

    return { success: true };
  }

  @CommandHandler("end-resize")
  async handleEndResize(
    args: { appId: string }
  ): Promise<any> {
    if (this.resizeState) {
      this.mouseTracker.unsubscribe(`resize-${this.resizeState.appId}`);
      this.resizeState = null;
    }
    return { success: true };
  }
}

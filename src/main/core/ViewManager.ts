import { BrowserWindow, WebContentsView } from "electron";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs/promises";
import { AppManifest, TilingConfig } from "../../types";

interface ViewInfo {
  view: WebContentsView;
  appId: string;
  manifest: AppManifest;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  tileIndex?: number; // Index in the tiling grid
}

/**
 * ViewManager
 *
 * Manages WebContentsView instances for app frontends.
 * Each app's frontend runs in its own isolated view.
 */
export class ViewManager extends EventEmitter {
  private views: Map<number, ViewInfo> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private nextViewId = 1;
  private tilingConfig: TilingConfig;
  private workspaceBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } = { x: 0, y: 0, width: 800, height: 600 };

  constructor(tilingConfig?: TilingConfig) {
    super();
    this.tilingConfig = tilingConfig || {
      mode: "none",
      gap: 0,
      padding: 0,
    };
  }

  /**
   * Set the main window that will host the views
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Set workspace bounds (the area where views can be placed)
   */
  setWorkspaceBounds(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    this.workspaceBounds = bounds;
    // Recalculate all tile bounds if using tiling
    if (this.tilingConfig.mode !== "none") {
      this.recalculateTiledViews();
    }
  }

  /**
   * Calculate bounds for a tile based on tiling configuration
   */
  private calculateTileBounds(tileIndex: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const {
      mode,
      gap = 0,
      padding = 0,
      columns = 2,
      rows = 2,
    } = this.tilingConfig;
    const {
      x: workX,
      y: workY,
      width: workWidth,
      height: workHeight,
    } = this.workspaceBounds;

    // Apply padding
    const availableX = workX + padding;
    const availableY = workY + padding;
    const availableWidth = workWidth - padding * 2;
    const availableHeight = workHeight - padding * 2;

    switch (mode) {
      case "horizontal": {
        // Split horizontally into equal tiles
        const visibleViews = Array.from(this.views.values()).filter(
          (v) => v.visible
        );
        const count = visibleViews.length;
        if (count === 0)
          return {
            x: availableX,
            y: availableY,
            width: availableWidth,
            height: availableHeight,
          };

        const tileWidth = (availableWidth - gap * (count - 1)) / count;
        return {
          x: availableX + tileIndex * (tileWidth + gap),
          y: availableY,
          width: tileWidth,
          height: availableHeight,
        };
      }

      case "vertical": {
        // Split vertically into equal tiles
        const visibleViews = Array.from(this.views.values()).filter(
          (v) => v.visible
        );
        const count = visibleViews.length;
        if (count === 0)
          return {
            x: availableX,
            y: availableY,
            width: availableWidth,
            height: availableHeight,
          };

        const tileHeight = (availableHeight - gap * (count - 1)) / count;
        return {
          x: availableX,
          y: availableY + tileIndex * (tileHeight + gap),
          width: availableWidth,
          height: tileHeight,
        };
      }

      case "grid": {
        // Grid layout
        const col = tileIndex % columns;
        const row = Math.floor(tileIndex / columns);
        const tileWidth = (availableWidth - gap * (columns - 1)) / columns;
        const tileHeight = (availableHeight - gap * (rows - 1)) / rows;

        return {
          x: availableX + col * (tileWidth + gap),
          y: availableY + row * (tileHeight + gap),
          width: tileWidth,
          height: tileHeight,
        };
      }

      default:
        // No tiling, return full workspace
        return {
          x: availableX,
          y: availableY,
          width: availableWidth,
          height: availableHeight,
        };
    }
  }

  /**
   * Recalculate bounds for all tiled views
   */
  private recalculateTiledViews(): void {
    if (this.tilingConfig.mode === "none") return;

    const visibleViews = Array.from(this.views.entries())
      .filter(([_, info]) => info.visible)
      .sort((a, b) => (a[1].tileIndex || 0) - (b[1].tileIndex || 0));

    console.log(
      `Recalculating ${visibleViews.length} tiled views in ${this.tilingConfig.mode} mode`
    );

    visibleViews.forEach(([viewId, info], index) => {
      const bounds = this.calculateTileBounds(index);
      info.tileIndex = index;
      info.bounds = bounds;
      info.view.setBounds(bounds);
      console.log(
        `View ${viewId} (${info.appId}): x=${bounds.x}, y=${bounds.y}, w=${bounds.width}, h=${bounds.height}`
      );
    });
  }

  /**
   * Get the next available tile index
   */
  private getNextTileIndex(): number {
    const indices = Array.from(this.views.values())
      .filter((v) => v.visible && v.tileIndex !== undefined)
      .map((v) => v.tileIndex!);

    if (indices.length === 0) return 0;
    return Math.max(...indices) + 1;
  }

  /**
   * Inject app API into the view's webContents
   * Sends the channel info so the universal preload can set up the API
   */
  private injectAppAPI(view: WebContentsView, appId: string): void {
    const channel = `app-${appId}`;
    const requestChannel = `app-${appId}-request`;

    view.webContents.send("init-app-api", {
      appId,
      channel,
      requestChannel,
    });

    console.log(`Sent app API init for ${appId}`);
  }

  /**
   * Inject app frame script into the view
   * This adds a title bar with close button to each app
   */
  private async injectAppFrame(view: WebContentsView): Promise<void> {
    try {
      const frameScriptPath = path.join(
        __dirname,
        "../../eveshell/app-frame-inject.js"
      );
      const frameScript = await fs.readFile(frameScriptPath, "utf-8");

      await view.webContents.executeJavaScript(frameScript);
      console.log("App frame injected successfully");
    } catch (error) {
      console.error("Failed to inject app frame:", error);
    }
  }

  /**
   * Create a view for an app
   */
  createView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: { x: number; y: number; width: number; height: number }
  ): number {
    if (!this.mainWindow) {
      throw new Error("Main window not set. Call setMainWindow first.");
    }

    // Use universal preload that provides safe API
    const universalPreload = path.join(
      __dirname,
      "../../eveshell/app-preload.js"
    );
    console.log(
      `Creating view for ${appId} with universal preload: ${universalPreload}`
    );

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: universalPreload,
      },
    });

    const viewId = this.nextViewId++;

    // Calculate bounds based on tiling configuration
    let viewBounds = bounds;
    let tileIndex: number | undefined = undefined;

    if (this.tilingConfig.mode !== "none") {
      tileIndex = this.getNextTileIndex();
      viewBounds = this.calculateTileBounds(tileIndex);
    }

    // Set bounds
    view.setBounds(viewBounds);

    // Load the frontend HTML
    const frontendPath = path.join(installPath, manifest.frontend.entry);
    view.webContents.loadFile(frontendPath);

    // Set up view event handlers
    view.webContents.on("did-finish-load", () => {
      // Inject the app frame script
      this.injectAppFrame(view);

      // Inject the app API after page load
      this.injectAppAPI(view, appId);
      this.emit("view-loaded", { viewId, appId });
    });

    view.webContents.on(
      "did-fail-load",
      (_event: any, errorCode: any, errorDescription: any) => {
        console.error(`View load failed for app ${appId}:`, errorDescription);
        this.emit("view-load-failed", {
          viewId,
          appId,
          errorCode,
          errorDescription,
        });
      }
    );

    // Add to main window's contentView
    this.mainWindow.contentView.addChildView(view);

    // Store view info
    this.views.set(viewId, {
      view,
      appId,
      manifest,
      bounds: viewBounds,
      visible: true,
      tileIndex,
    });

    // Recalculate all tiles if using tiling
    if (this.tilingConfig.mode !== "none") {
      this.recalculateTiledViews();
    }

    return viewId;
  }

  /**
   * Remove a view
   */
  removeView(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      return false;
    }

    try {
      // Check if view is already destroyed
      if (!viewInfo.view.webContents.isDestroyed()) {
        // Only try to remove if mainWindow still exists and view is not destroyed
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.contentView.removeChildView(viewInfo.view);
        }
      }

      // Always remove from our tracking map
      this.views.delete(viewId);

      // Recalculate tiles if using tiling
      if (this.tilingConfig.mode !== "none") {
        this.recalculateTiledViews();
      }

      return true;
    } catch (error) {
      console.error(`Failed to remove view ${viewId}:`, error);
      // Still remove from tracking even if removal failed
      this.views.delete(viewId);
      return false;
    }
  }

  /**
   * Update view bounds
   */
  setViewBounds(
    viewId: number,
    bounds: { x: number; y: number; width: number; height: number }
  ): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      return false;
    }

    // If tiling is enabled, ignore individual bounds updates
    // Bounds are managed by the tiling system
    if (this.tilingConfig.mode !== "none") {
      console.log(
        `Ignoring individual bounds update for view ${viewId} - tiling mode is active`
      );
      return true;
    }

    // Don't update bounds if view is hidden
    if (!viewInfo.visible) {
      // Still store the bounds for when view becomes visible again
      viewInfo.bounds = bounds;
      return true;
    }

    try {
      viewInfo.view.setBounds(bounds);
      viewInfo.bounds = bounds;
      return true;
    } catch (error) {
      console.error(`Failed to set bounds for view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Get view by ID
   */
  getView(viewId: number): WebContentsView | undefined {
    return this.views.get(viewId)?.view;
  }

  /**
   * Get view info
   */
  getViewInfo(viewId: number): ViewInfo | undefined {
    return this.views.get(viewId);
  }

  /**
   * Find views by app ID
   */
  getViewsByAppId(appId: string): number[] {
    const viewIds: number[] = [];
    for (const [viewId, info] of this.views.entries()) {
      if (info.appId === appId) {
        viewIds.push(viewId);
      }
    }
    return viewIds;
  }

  /**
   * Show a view (bring to front)
   */
  showView(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      // Mark as visible first
      viewInfo.visible = true;

      // If tiling is enabled, recalculate all tiles
      if (this.tilingConfig.mode !== "none") {
        this.recalculateTiledViews();
      } else {
        // No tiling - just bring to front with stored bounds
        // Remove and re-add to bring to front
        this.mainWindow.contentView.removeChildView(viewInfo.view);
        this.mainWindow.contentView.addChildView(viewInfo.view);
        // Restore original bounds
        viewInfo.view.setBounds(viewInfo.bounds);
      }

      return true;
    } catch (error) {
      console.error(`Failed to show view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Hide a view by setting its bounds to zero
   */
  hideView(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      // Mark as hidden
      viewInfo.visible = false;

      // Always hide by setting bounds to zero
      viewInfo.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

      // If tiling is enabled, recalculate tiles for remaining visible views
      if (this.tilingConfig.mode !== "none") {
        this.recalculateTiledViews();
      }

      return true;
    } catch (error) {
      console.error(`Failed to hide view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Bring a view to the front (highest z-index)
   */
  bringToFront(viewId: number): boolean {
    return this.showView(viewId);
  }

  /**
   * Send a view to the back (lowest z-index)
   */
  sendToBack(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      // Get all child views
      const allViews = Array.from(this.views.values()).map((v) => v.view);

      // Remove all views
      for (const v of allViews) {
        this.mainWindow.contentView.removeChildView(v);
      }

      // Add target view first (back), then all others
      this.mainWindow.contentView.addChildView(viewInfo.view);
      viewInfo.view.setBounds(viewInfo.bounds);

      for (const v of allViews) {
        if (v !== viewInfo.view) {
          this.mainWindow.contentView.addChildView(v);
          // Restore bounds from stored info
          const info = Array.from(this.views.values()).find(
            (i) => i.view === v
          );
          if (info) {
            v.setBounds(info.bounds);
          }
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to send view ${viewId} to back:`, error);
      return false;
    }
  }

  /**
   * Set the z-order of a view relative to other views
   * @param viewId - The view to reorder
   * @param position - Position in z-order (0 = back, higher = more front)
   */
  setZOrder(viewId: number, position: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      const allViews = Array.from(this.views.values()).map((v) => v.view);
      const targetIndex = Math.max(0, Math.min(position, allViews.length - 1));

      // Remove all views
      for (const v of allViews) {
        this.mainWindow.contentView.removeChildView(v);
      }

      // Re-add in desired order
      const otherViews = allViews.filter((v) => v !== viewInfo.view);
      const orderedViews = [
        ...otherViews.slice(0, targetIndex),
        viewInfo.view,
        ...otherViews.slice(targetIndex),
      ];

      for (const v of orderedViews) {
        this.mainWindow.contentView.addChildView(v);
        const info = Array.from(this.views.values()).find((i) => i.view === v);
        if (info) {
          v.setBounds(info.bounds);
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to set z-order for view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Send message to view's webContents
   */
  sendToView(viewId: number, channel: string, ...args: any[]): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      return false;
    }

    try {
      viewInfo.view.webContents.send(channel, ...args);
      return true;
    } catch (error) {
      console.error(`Failed to send message to view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Get all active view IDs
   */
  getActiveViews(): number[] {
    return Array.from(this.views.keys());
  }

  /**
   * Remove all views
   */
  removeAllViews(): void {
    for (const viewId of this.views.keys()) {
      this.removeView(viewId);
    }
  }
}

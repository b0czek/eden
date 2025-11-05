import { BrowserWindow, WebContentsView } from "electron";
import { EventEmitter } from "events";
import * as path from "path";
import { AppManifest } from "../../types";

interface ViewInfo {
  view: WebContentsView;
  appId: string;
  manifest: AppManifest;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
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

  /**
   * Set the main window that will host the views
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
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
      "../../renderer/app-preload.js"
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

    // Set bounds
    view.setBounds(bounds);

    // Load the frontend HTML
    const frontendPath = path.join(installPath, manifest.frontend.entry);
    view.webContents.loadFile(frontendPath);

    // Set up view event handlers
    view.webContents.on("did-finish-load", () => {
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
      bounds,
      visible: true,
    });

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
      // Remove and re-add to bring to front
      this.mainWindow.contentView.removeChildView(viewInfo.view);
      this.mainWindow.contentView.addChildView(viewInfo.view);
      // Restore original bounds
      viewInfo.view.setBounds(viewInfo.bounds);
      viewInfo.visible = true;
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
      // Hide by setting bounds to zero size
      viewInfo.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      viewInfo.visible = false;
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

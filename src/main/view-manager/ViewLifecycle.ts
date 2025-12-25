import { BrowserWindow, WebContentsView } from "electron";
import { ViewInfo } from "./types";

/**
 * ViewGuard
 *
 * Utility class for validating view state before operations.
 * Provides defensive checks to prevent crashes from destroyed views.
 */
export class ViewGuard {
  /**
   * Check if a WebContentsView exists and is valid
   */
  static isValid(view?: WebContentsView): view is WebContentsView {
    return view !== undefined && view !== null;
  }

  /**
   * Check if a WebContentsView's webContents is still alive (not destroyed)
   */
  static isAlive(view?: WebContentsView): boolean {
    if (!ViewGuard.isValid(view)) return false;
    try {
      return !view.webContents.isDestroyed();
    } catch {
      return false;
    }
  }

  /**
   * Check if a BrowserWindow exists and is not destroyed
   */
  static isWindowAlive(window?: BrowserWindow | null): window is BrowserWindow {
    return window !== undefined && window !== null && !window.isDestroyed();
  }

  /**
   * Get a view from the map with validation
   * Throws an error if view is not found or destroyed
   */
  static requireView(viewId: number, views: Map<number, ViewInfo>): ViewInfo {
    const viewInfo = views.get(viewId);

    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    if (!ViewGuard.isAlive(viewInfo.view)) {
      throw new Error(`View ${viewId} is destroyed`);
    }

    return viewInfo;
  }

  /**
   * Get a view by app ID from the map, returning the first matching view
   * Throws an error if view is not found or destroyed
   */
  static requireViewByAppId(
    appId: string,
    views: Map<number, ViewInfo>
  ): { viewId: number; viewInfo: ViewInfo } {
    for (const [viewId, info] of views.entries()) {
      if (info.appId === appId) {
        if (!ViewGuard.isAlive(info.view)) {
          throw new Error(`View for app ${appId} is destroyed`);
        }
        return { viewId, viewInfo: info };
      }
    }

    throw new Error(`No view found for app ${appId}`);
  }
}

/**
 * Options for creating a WebContentsView
 */
export interface ViewCreationOptions {
  preloadScript: string;
  transparent?: boolean;
  backgroundThrottling?: boolean;
}

/**
 * ViewLifecycle
 *
 * Handles creation and destruction of WebContentsViews.
 * Provides safe lifecycle management with proper cleanup.
 */
export class ViewLifecycle {
  /**
   * Create a new WebContentsView with standard options
   */
  static createView(options: ViewCreationOptions): WebContentsView {
    const {
      preloadScript,
      transparent = true,
      backgroundThrottling = false,
    } = options;

    return new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: preloadScript,
        transparent,
        backgroundThrottling,
        scrollBounce: false,
      },
    });
  }

  /**
   * Safely destroy a view and remove it from the main window
   */
  static destroyView(
    viewInfo: ViewInfo,
    mainWindow: BrowserWindow | null
  ): void {
    try {
      // Check if view is already destroyed
      if (!ViewGuard.isAlive(viewInfo.view)) {
        // View already destroyed, nothing to do
        return;
      }

      // Remove from main window if window still exists
      if (ViewGuard.isWindowAlive(mainWindow)) {
        try {
          mainWindow.contentView.removeChildView(viewInfo.view);
        } catch (error) {
          // Ignore errors during removal - view might already be removed
          console.warn(
            "[ViewLifecycle] Ignoring error during view removal:",
            error
          );
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      console.error("[ViewLifecycle] Failed to destroy view:", errorMessage);
      throw new Error(`Failed to destroy view: ${errorMessage}`);
    }
  }

  /**
   * Remove all destroyed views from a view map
   * Returns the number of views cleaned up
   */
  static cleanupDestroyedViews(views: Map<number, ViewInfo>): number {
    const destroyedIds: number[] = [];

    for (const [viewId, info] of views.entries()) {
      if (!ViewGuard.isAlive(info.view)) {
        destroyedIds.push(viewId);
      }
    }

    for (const id of destroyedIds) {
      views.delete(id);
    }

    if (destroyedIds.length > 0) {
      console.log(
        `[ViewLifecycle] Cleaned up ${destroyedIds.length} destroyed views`
      );
    }

    return destroyedIds.length;
  }
}

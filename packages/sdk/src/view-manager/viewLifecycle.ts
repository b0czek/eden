import { type BrowserWindow, WebContentsView } from "electron";
import { log } from "../logging";
import type { ViewCreationOptions, ViewInfo } from "./types";
/**
 * Check if a WebContentsView exists and is valid.
 */
export function isValidView(view?: WebContentsView): view is WebContentsView {
  return view !== undefined && view !== null;
}

/**
 * Check if a WebContentsView's webContents is still alive (not destroyed).
 */
export function isViewAlive(view?: WebContentsView): boolean {
  if (!isValidView(view)) return false;
  try {
    return !view.webContents.isDestroyed();
  } catch {
    return false;
  }
}

/**
 * Check if a BrowserWindow exists and is not destroyed.
 */
export function isWindowAlive(
  window?: BrowserWindow | null,
): window is BrowserWindow {
  return window !== undefined && window !== null && !window.isDestroyed();
}

/**
 * Get a view from the map with validation.
 * Throws an error if view is not found or destroyed.
 */
export function requireView(
  viewId: number,
  views: Map<number, ViewInfo>,
): ViewInfo {
  const viewInfo = views.get(viewId);

  if (!viewInfo) {
    throw new Error(`View ${viewId} not found`);
  }

  if (!isViewAlive(viewInfo.view)) {
    throw new Error(`View ${viewId} is destroyed`);
  }

  return viewInfo;
}

/**
 * Get a view by app ID from the map, returning the first matching view.
 * Throws an error if view is not found or destroyed.
 */
export function requireViewByAppId(
  appId: string,
  views: Map<number, ViewInfo>,
): { viewId: number; viewInfo: ViewInfo } {
  for (const [viewId, info] of views.entries()) {
    if (info.appId === appId) {
      if (!isViewAlive(info.view)) {
        throw new Error(`View for app ${appId} is destroyed`);
      }
      return { viewId, viewInfo: info };
    }
  }

  throw new Error(`No view found for app ${appId}`);
}

/**
 * Create a new WebContentsView with standard options.
 */
export function createView(options: ViewCreationOptions): WebContentsView {
  const {
    preloadScript,
    transparent = true,
    backgroundThrottling = false,
    additionalArguments = [],
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
      spellcheck: false,
      additionalArguments,
    },
  });
}

/**
 * Safely destroy a view and remove it from the main window.
 */
export function destroyView(
  viewInfo: ViewInfo,
  mainWindow: BrowserWindow | null,
): void {
  try {
    // Check if view is already destroyed
    if (!isViewAlive(viewInfo.view)) {
      // View already destroyed, nothing to do
      return;
    }

    // Remove from main window if window still exists
    if (isWindowAlive(mainWindow)) {
      try {
        mainWindow.contentView.removeChildView(viewInfo.view);
      } catch (error) {
        // Ignore errors during removal - view might already be removed
        log.warn("Ignoring error during view removal:", error);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Failed to destroy view:", errorMessage);
    throw new Error(`Failed to destroy view: ${errorMessage}`);
  }
}

/**
 * Remove all destroyed views from a view map.
 * Returns the number of views cleaned up.
 */
export function cleanupDestroyedViews(views: Map<number, ViewInfo>): number {
  const destroyedIds: number[] = [];

  for (const [viewId, info] of views.entries()) {
    if (!isViewAlive(info.view)) {
      destroyedIds.push(viewId);
    }
  }

  for (const id of destroyedIds) {
    views.delete(id);
  }

  if (destroyedIds.length > 0) {
    log.info(`Cleaned up ${destroyedIds.length} destroyed views`);
  }

  return destroyedIds.length;
}

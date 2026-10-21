import { log } from "../logging/logger";
import type {
  PlatformView,
  PlatformWindow,
  WindowingPort,
} from "../platform/ports/types";
import { ViewNativeFailure, ViewUnavailable } from "./errors";
import type { ViewCreationOptions, ViewInfo } from "./types";
/**
 * Check if a WebContentsView exists and is valid.
 */
export function isValidView(view?: PlatformView): view is PlatformView {
  return view !== undefined && view !== null;
}

/**
 * Check if a WebContentsView's webContents is still alive (not destroyed).
 */
export function isViewAlive(view?: PlatformView): boolean {
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
  window?: PlatformWindow | null,
): window is PlatformWindow {
  return window !== undefined && window !== null && !window.isDestroyed();
}

/**
 * Get a view from the map with validation.
 * Throws an error if view is not found or destroyed.
 */
export function requireView(
  viewId: number,
  views: ReadonlyMap<number, ViewInfo>,
): ViewInfo {
  const viewInfo = views.get(viewId);

  if (!viewInfo) {
    throw new ViewUnavailable({ viewId, reason: "missing" });
  }

  if (!isViewAlive(viewInfo.view)) {
    throw new ViewUnavailable({
      viewId,
      appId: viewInfo.appId,
      reason: "destroyed",
    });
  }

  return viewInfo;
}

/**
 * Get a view by app ID from the map, returning the first matching view.
 * Throws an error if view is not found or destroyed.
 */
export function requireViewByAppId(
  appId: string,
  views: ReadonlyMap<number, ViewInfo>,
): { viewId: number; viewInfo: ViewInfo } {
  for (const [viewId, info] of views.entries()) {
    if (info.appId === appId) {
      if (!isViewAlive(info.view)) {
        throw new ViewUnavailable({ viewId, appId, reason: "destroyed" });
      }
      return { viewId, viewInfo: info };
    }
  }

  throw new ViewUnavailable({ appId, reason: "missing" });
}

/**
 * Create a new WebContentsView with standard options.
 */
export function createView(
  options: ViewCreationOptions,
  windows: WindowingPort,
  context: { appId: string; viewId: number },
): PlatformView {
  const {
    preloadScript,
    transparent = true,
    backgroundThrottling = false,
    additionalArguments = [],
  } = options;

  try {
    return windows.createView({
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
  } catch (cause) {
    throw new ViewNativeFailure({ operation: "create", ...context, cause });
  }
}

/**
 * Safely destroy a view and remove it from the main window.
 */
export function destroyView(
  viewInfo: ViewInfo,
  mainWindow: PlatformWindow | null,
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

    // Detaching the view from the window is not enough. The renderer process
    // keeps running until its webContents is explicitly closed.
    if (!viewInfo.view.webContents.isDestroyed()) {
      viewInfo.view.webContents.close();
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error("Failed to destroy view:", errorMessage);
    throw new ViewNativeFailure({
      operation: "destroy",
      viewId: viewInfo.id,
      appId: viewInfo.appId,
      cause: error,
    });
  }
}

/**
 * Remove all destroyed views from a view map.
 * Returns the removed views so their owner can release associated state.
 */
export function cleanupDestroyedViews(
  views: Map<number, ViewInfo>,
): ViewInfo[] {
  const destroyedViews: ViewInfo[] = [];

  for (const info of views.values()) {
    if (!isViewAlive(info.view)) {
      destroyedViews.push(info);
    }
  }

  for (const info of destroyedViews) {
    views.delete(info.id);
  }

  if (destroyedViews.length > 0) {
    log.info(`Cleaned up ${destroyedViews.length} destroyed views`);
  }

  return destroyedViews;
}

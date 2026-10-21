import * as Result from "effect/Result";
import { log } from "../logging/logger";
import type {
  PlatformView,
  PlatformWindow,
  WindowingPort,
} from "../platform/ports/types";
import {
  callViewNative,
  type ViewNativeFailure,
  ViewUnavailable,
} from "./errors";
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

/** Synchronous callers share the same validation as Effect workflows. */
export function requireView(
  viewId: number,
  views: ReadonlyMap<number, ViewInfo>,
): ViewInfo {
  return Result.getOrThrow(findView(viewId, views));
}

export function findView(
  viewId: number,
  views: ReadonlyMap<number, ViewInfo>,
): Result.Result<ViewInfo, ViewUnavailable> {
  const info = views.get(viewId);
  if (!info)
    return Result.fail(new ViewUnavailable({ viewId, reason: "missing" }));
  if (!isViewAlive(info.view))
    return Result.fail(
      new ViewUnavailable({ viewId, appId: info.appId, reason: "destroyed" }),
    );
  return Result.succeed(info);
}

/**
 * Create a new WebContentsView with standard options.
 */
export function createView(
  options: ViewCreationOptions,
  windows: WindowingPort,
  context: { appId: string; viewId: number },
): Result.Result<PlatformView, ViewNativeFailure> {
  const {
    preloadScript,
    transparent = true,
    backgroundThrottling = false,
    additionalArguments = [],
  } = options;

  return callViewNative(
    "create",
    { id: context.viewId, appId: context.appId },
    () =>
      windows.createView({
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
      }),
  );
}

/**
 * Safely destroy a view and remove it from the main window.
 */
export function destroyView(
  viewInfo: ViewInfo,
  mainWindow: PlatformWindow | null,
): Result.Result<void, ViewNativeFailure> {
  if (!isViewAlive(viewInfo.view)) return Result.succeed(undefined);
  if (isWindowAlive(mainWindow)) {
    const detached = callViewNative("destroy", viewInfo, () =>
      mainWindow.contentView.removeChildView(viewInfo.view),
    );
    if (Result.isFailure(detached))
      log.warn("Ignoring error during view removal:", detached.failure.cause);
  }
  return callViewNative("destroy", viewInfo, () => {
    // Detaching alone leaves the renderer running.
    if (!viewInfo.view.webContents.isDestroyed())
      viewInfo.view.webContents.close();
  });
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

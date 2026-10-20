import type { AppManifest, FilesystemLocation } from "@edenapp/types";
import type { Event } from "../events/event";
import { log } from "../logging";
import type {
  Bounds,
  PlatformView,
  PlatformWindow,
  WindowingPort,
} from "../platform/ports";
import type { ViewLayout } from "./coordination";
import type { ViewDevTools } from "./devtools";
import {
  callViewNative,
  MainWindowUnavailable,
  ViewUnavailable,
} from "./errors";
import type { InterfaceScale } from "./interface-scale";
import {
  cleanupDestroyedViews,
  destroyView,
  isWindowAlive,
  requireView,
} from "./lifecycle";
import type { ViewRendering } from "./rendering";
import type { Views } from "./service";
import type { ViewInfo, ViewsEvents } from "./types";

type ViewLifecycleLayout = Pick<
  ViewLayout,
  | "isTilingEnabled"
  | "restoreExpansionForView"
  | "syncTiledLayout"
  | "reorderViewLayers"
>;

export interface ViewRegistry
  extends Pick<
    Views,
    | "setMainWindow"
    | "getView"
    | "getViewInfo"
    | "getViewsByAppId"
    | "getAppIdByWebContentsId"
    | "getViewIdByWebContentsId"
    | "getAllViews"
    | "sendToView"
    | "sendToMainWindow"
    | "getActiveViews"
  > {
  readonly views: ReadonlyMap<number, ViewInfo>;
  focusView(viewId: number): void;
  getMainWindow(): PlatformWindow | null;
  createView(
    layout: ViewLifecycleLayout,
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ): number;
  removeView(layout: ViewLifecycleLayout, viewId: number): void;
  cleanupDestroyed(): void;
  dispose(): void;
}

export function createViewRegistry(
  _windows: WindowingPort,
  _rendering: ViewRendering,
  _interfaceScale: InterfaceScale,
  _devtools: ViewDevTools,
  events: {
    viewRemoved: Event<ViewsEvents["view-removed"]>;
    viewLoaded: Event<ViewsEvents["view-loaded"]>;
    viewLoadFailed: Event<ViewsEvents["view-load-failed"]>;
  },
): ViewRegistry {
  const _views = new Map<number, ViewInfo>();
  const _viewsByWebContentsId = new Map<number, ViewInfo>();
  let _mainWindow: PlatformWindow | null = null;
  const { viewRemoved, viewLoaded, viewLoadFailed } = events;
  function markViewFocused(viewInfo: ViewInfo): void {
    viewInfo.lastFocusedAt = Date.now();
  }

  function attachFocusTracking(viewId: number, viewInfo: ViewInfo): void {
    callViewNative("register", viewInfo, () => {
      viewInfo.view.webContents.on("focus", () => {
        const trackedView = _views.get(viewId);
        if (!trackedView) return;
        markViewFocused(trackedView);
      });
    });
  }

  function setMainWindow(window: PlatformWindow): void {
    _mainWindow = window;
  }

  function createView(
    layout: ViewLifecycleLayout,
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ): number {
    if (!isWindowAlive(_mainWindow)) {
      throw new MainWindowUnavailable({ appId });
    }

    const viewInfo = _rendering.createView(
      appId,
      manifest,
      installPath,
      bounds,
      _views.values(),
      launchArgs,
      launchFile,
    );

    try {
      const viewId = viewInfo.id;

      callViewNative("register", viewInfo, () => {
        _windows.attachWebContentsLogger(viewInfo.view.webContents, {
          appId,
          viewId,
          source: viewInfo.viewType === "overlay" ? "overlay" : "app",
        });
      });

      // Store view info
      _views.set(viewId, viewInfo);
      _viewsByWebContentsId.set(viewInfo.view.webContents.id, viewInfo);
      attachFocusTracking(viewId, viewInfo);

      // Apply current interface scale to the new view
      _interfaceScale.applyToView(viewInfo);

      // Register DevTools shortcut on this view
      _devtools.registerShortcut(viewInfo.view);

      // Re-apply zoom after page finishes loading (content load can reset zoom)
      callViewNative("register", viewInfo, () => {
        viewInfo.view.webContents.on("did-finish-load", () => {
          _interfaceScale.applyToView(viewInfo);
        });

        // Electron event listener for view load failure
        viewInfo.view.webContents.on(
          "did-fail-load",
          (_event, errorCode: number, errorDescription: string) => {
            log.error(`View load failed for ${appId}:`, errorDescription);
            viewLoadFailed.emit({
              viewId: viewInfo.id,
              appId,
              errorCode,
              errorDescription,
            });
          },
        );
      });

      // Notify listeners that the view has been loaded
      viewLoaded.emit({
        viewId: viewInfo.id,
        appId,
        overlay: viewInfo.viewType === "overlay",
      });

      // Recalculate all tiles if using tiling and this is a tiled view
      if (viewInfo.mode === "tiled" && layout.isTilingEnabled()) {
        layout.syncTiledLayout({ preferredViewId: viewId });
      }

      // Add to main window's contentView and maintain proper layering
      layout.reorderViewLayers();

      return viewId;
    } catch (error) {
      try {
        if (_views.has(viewInfo.id)) removeView(layout, viewInfo.id);
        else destroyView(viewInfo, _mainWindow);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to create and release view for ${appId}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  function removeView(layout: ViewLifecycleLayout, viewId: number): void {
    const viewInfo = _views.get(viewId);
    if (!viewInfo) {
      throw new ViewUnavailable({ viewId, reason: "missing" });
    }
    const webContentsId = viewInfo.view.webContents.id;

    const failures: unknown[] = [];
    try {
      layout.restoreExpansionForView(viewId);
      _devtools.closeDevToolsForView(viewInfo.view);
    } catch (error) {
      failures.push(error);
    }
    try {
      destroyView(viewInfo, _mainWindow);
    } catch (error) {
      failures.push(error);
      try {
        if (!viewInfo.view.webContents.isDestroyed())
          callViewNative("destroy", viewInfo, () =>
            viewInfo.view.webContents.close(),
          );
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (_views.delete(viewId)) {
      _viewsByWebContentsId.delete(webContentsId);
      viewRemoved.emit({ viewId, appId: viewInfo.appId, webContentsId });
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, `Failed to release view ${viewId}`, {
        cause: failures[0],
      });
    if (viewInfo.viewType === "app" && layout.isTilingEnabled()) {
      const visibilityChanged = layout.syncTiledLayout();
      if (visibilityChanged) layout.reorderViewLayers();
    }
  }

  function getView(viewId: number): PlatformView | undefined {
    return _views.get(viewId)?.view;
  }

  function getViewInfo(viewId: number): ViewInfo | undefined {
    return _views.get(viewId);
  }

  function getViewsByAppId(appId: string): number[] {
    const viewIds: number[] = [];
    for (const [viewId, info] of _views.entries()) {
      if (info.appId === appId) {
        viewIds.push(viewId);
      }
    }
    return viewIds;
  }

  function getAppIdByWebContentsId(webContentsId: number): string | undefined {
    return _viewsByWebContentsId.get(webContentsId)?.appId;
  }

  function getViewIdByWebContentsId(webContentsId: number): number | undefined {
    return _viewsByWebContentsId.get(webContentsId)?.id;
  }

  function getAllViews(): [number, ViewInfo][] {
    return Array.from(_views.entries());
  }

  function focusView(viewId: number): void {
    const viewInfo = requireView(viewId, _views);
    if (viewInfo.view.webContents.isDestroyed()) return;
    callViewNative("focus", viewInfo, () => viewInfo.view.webContents.focus());
  }

  function sendToView(
    viewId: number,
    channel: string,
    ...args: unknown[]
  ): boolean {
    try {
      const viewInfo = requireView(viewId, _views);
      viewInfo.view.webContents.send(channel, ...args);
      return true;
    } catch (error) {
      log.error(`Failed to send message to view ${viewId}:`, error);
      return false;
    }
  }

  function sendToMainWindow(channel: string, ...args: unknown[]): boolean {
    if (_mainWindow && !_mainWindow.isDestroyed()) {
      try {
        _mainWindow.webContents.send(channel, ...args);
        return true;
      } catch (error) {
        log.error(`Failed to send to main window:`, error);
        return false;
      }
    }
    return false;
  }

  function getActiveViews(): number[] {
    return Array.from(_views.keys());
  }

  function dispose(): void {
    for (const info of _views.values()) {
      try {
        destroyView(info, _mainWindow);
      } catch (error) {
        log.warn(`Failed to destroy view ${info.id} during disposal:`, error);
      }
    }
    _views.clear();
    _viewsByWebContentsId.clear();
    _mainWindow = null;
  }
  function cleanupDestroyed(): void {
    for (const info of cleanupDestroyedViews(_views)) {
      _viewsByWebContentsId.delete(info.view.webContents.id);
    }
  }
  return {
    views: _views,
    getMainWindow: () => _mainWindow,
    cleanupDestroyed,
    setMainWindow,
    createView,
    removeView,
    getView,
    getViewInfo,
    getViewsByAppId,
    getAppIdByWebContentsId,
    getViewIdByWebContentsId,
    getAllViews,
    focusView,
    sendToView,
    sendToMainWindow,
    getActiveViews,
    dispose,
  };
}

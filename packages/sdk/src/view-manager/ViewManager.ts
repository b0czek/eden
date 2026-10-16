import type {
  AppManifest,
  EdenConfig,
  FilesystemLocation,
  TileLayoutDirection,
  TileLayoutState,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { TargetedNotification } from "../controllers/events";
import { scopedEvent } from "../events/scoped";

import { log } from "../logging";
import {
  type Bounds,
  type PlatformView,
  type PlatformWindow,
  type WindowingPort,
} from "../platform/ports";
import type { Settings } from "../settings/service";
import {
  createDevToolsController,
  type DevToolsController,
} from "./DevToolsController";
import {
  createFloatingWindowController,
  type FloatingWindowController,
} from "./FloatingWindowController";
import {
  createPresentationController,
  type PresentationController,
} from "./PresentationController";
import { createScaleController, type ScaleController } from "./ScaleController";
import {
  createTilingController,
  type TilingController,
} from "./TilingController";
import { compareOverlayViews, type ViewInfo, type ViewMode } from "./types";
import { createViewCreator, type ViewCreator } from "./ViewCreator";

import {
  cleanupDestroyedViews,
  destroyView,
  isViewAlive,
  isWindowAlive,
  requireView,
} from "./viewLifecycle";

/**
 * Events emitted by the ViewManager
 */
export interface ViewManagerEvents {
  "view-removed": { viewId: number; appId: string; webContentsId: number };
  "bounds-updated": ViewBounds;
  "interface-scale-changed": { scale: number };
  "view-loaded": { viewId: number; appId: string; overlay: boolean };
  "view-load-failed": {
    viewId: number;
    appId: string;
    errorCode: number;
    errorDescription: string;
  };
  "mode-changed": { mode: "floating" | "tiled"; bounds: ViewBounds };
  "global-bounds-changed": {
    workspaceBounds: ViewBounds;
    windowSize: WindowSize;
  };
}
export interface ViewManagerDependencies {
  config: EdenConfig;
  distPath: string;
  settings: Pick<Settings, "get" | "changed">;
  windows: WindowingPort;
}

export const createViewManager = Effect.fn(function* ({
  config,
  distPath,
  settings,
  windows,
}: ViewManagerDependencies) {
  const viewRemoved = yield* scopedEvent<ViewManagerEvents["view-removed"]>();
  const viewLoaded = yield* scopedEvent<ViewManagerEvents["view-loaded"]>();
  const viewLoadFailed =
    yield* scopedEvent<ViewManagerEvents["view-load-failed"]>();
  const interfaceScaleChanged =
    yield* scopedEvent<ViewManagerEvents["interface-scale-changed"]>();
  const globalBoundsChanged =
    yield* scopedEvent<ViewManagerEvents["global-bounds-changed"]>();
  const boundsUpdated = yield* scopedEvent<TargetedNotification<ViewBounds>>();
  const modeChanged =
    yield* scopedEvent<
      TargetedNotification<ViewManagerEvents["mode-changed"]>
    >();
  const _windows = windows;
  let _views: Map<number, ViewInfo> = new Map();
  let _mainWindow: PlatformWindow | null = null;
  let _tilingController: TilingController;
  let _floatingWindows: FloatingWindowController;
  let _presentationController: PresentationController;
  let _viewCreator: ViewCreator;
  let _devToolsController: DevToolsController;
  let _scaleController: ScaleController;
  let _windowSize: WindowSize = { width: 800, height: 600 };

  // Initialize specialized modules
  const tilingConfig = config.tiling || { mode: "none", gap: 0, padding: 0 };
  const getViews = () => _views.values();

  _devToolsController = createDevToolsController();
  _presentationController = createPresentationController();
  _scaleController = yield* createScaleController(
    settings,
    getViews,
    (scale, previousScale) => handleInterfaceScaleChanged(scale, previousScale),
  );
  _tilingController = createTilingController(tilingConfig, undefined, () =>
    _scaleController.getScale(),
  );

  _floatingWindows = createFloatingWindowController(
    () => _tilingController.getWorkspaceBounds(),
    getViews,
    () => _scaleController.getScale(),
  );

  // Use consumer's dist path for runtime assets
  _viewCreator = yield* createViewCreator(
    distPath,
    _tilingController,
    _floatingWindows,
    _windows,
  );

  function markViewFocused(viewInfo: ViewInfo): void {
    viewInfo.lastFocusedAt = Date.now();
  }

  function handleInterfaceScaleChanged(
    scale: number,
    previousScale: number,
  ): void {
    interfaceScaleChanged.emit({ scale });

    if (scale === previousScale || !_floatingWindows) {
      return;
    }

    const ratio = scale / previousScale;
    for (const viewInfo of _views.values()) {
      const automaticallyScaled =
        viewInfo.manifest.window?.scaling === "auto" ||
        (viewInfo.viewType === "app" &&
          viewInfo.manifest.window?.scaling !== "manual");
      if (viewInfo.mode !== "floating" || !automaticallyScaled) {
        continue;
      }

      const scaledBounds = {
        ...viewInfo.bounds,
        width: Math.round(viewInfo.bounds.width * ratio),
        height: Math.round(viewInfo.bounds.height * ratio),
      };
      const finalBounds =
        viewInfo.viewType === "overlay"
          ? scaledBounds
          : _floatingWindows.applyWindowConstraints(
              scaledBounds,
              viewInfo.manifest.window,
            );
      viewInfo.bounds = finalBounds;
      if (viewInfo.visible) {
        applyPresentedBounds(viewInfo, finalBounds);
      }
    }

    syncTiledLayout();
  }

  function attachFocusTracking(viewId: number, viewInfo: ViewInfo): void {
    viewInfo.view.webContents.on("focus", () => {
      const trackedView = _views.get(viewId);
      if (!trackedView) return;
      markViewFocused(trackedView);
    });
  }

  function setMainWindow(window: PlatformWindow): void {
    _mainWindow = window;
  }

  function updateGlobalBounds(
    bounds: ViewBounds,
    windowSize: WindowSize,
  ): void {
    setWorkspaceBounds(bounds);
    setWindowSize(windowSize);
    globalBoundsChanged.emit({
      workspaceBounds: bounds,
      windowSize,
    });
  }

  function setWorkspaceBounds(bounds: Bounds): void {
    _tilingController.setWorkspaceBounds(bounds);
    if (_tilingController.isEnabled()) {
      const visibilityChanged = syncTiledLayout();
      if (visibilityChanged) {
        reorderViewLayers();
      }
    }
  }

  function syncTiledLayout(
    options: { preferredViewId?: number; excludedViewId?: number } = {},
  ): boolean {
    const { toHide, toShow } = _tilingController.resolveTiledVisibilityChanges(
      _views,
      options,
    );

    let visibilityChanged = false;

    for (const viewId of toHide) {
      const viewInfo = _views.get(viewId);
      if (!viewInfo?.visible) continue;

      _tilingController.restoreExpansionForView(viewId);
      viewInfo.visible = false;
      viewInfo.bounds = { x: 0, y: 0, width: 0, height: 0 };

      if (!viewInfo.view.webContents.isDestroyed()) {
        viewInfo.view.setBounds(viewInfo.bounds);
      }

      visibilityChanged = true;
    }

    for (const viewId of toShow) {
      const viewInfo = _views.get(viewId);
      if (!viewInfo || viewInfo.visible) continue;

      viewInfo.visible = true;
      visibilityChanged = true;
    }

    _tilingController.recalculateTiledViews(_views);
    reapplyPresentedBounds();
    return visibilityChanged;
  }

  function setWindowSize(windowSize: WindowSize): void {
    _windowSize = windowSize;
  }

  function getWindowSize(): WindowSize {
    return _windowSize;
  }

  function createView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ): number {
    if (!isWindowAlive(_mainWindow)) {
      throw new Error("Main window not set. Call setMainWindow first.");
    }

    const viewInfo = _viewCreator.createView(
      appId,
      manifest,
      installPath,
      bounds,
      _views.values(),
      launchArgs,
      launchFile,
    );

    const viewId = viewInfo.id;

    _windows.attachWebContentsLogger(viewInfo.view.webContents, {
      appId,
      viewId,
      source: viewInfo.viewType === "overlay" ? "overlay" : "app",
    });

    // Store view info
    _views.set(viewId, viewInfo);
    attachFocusTracking(viewId, viewInfo);

    // Apply current interface scale to the new view
    _scaleController.applyToView(viewInfo);

    // Register DevTools shortcut on this view
    _devToolsController.registerShortcut(viewInfo.view);

    // Re-apply zoom after page finishes loading (content load can reset zoom)
    viewInfo.view.webContents.on("did-finish-load", () => {
      _scaleController.applyToView(viewInfo);
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

    // Notify listeners that the view has been loaded
    viewLoaded.emit({
      viewId: viewInfo.id,
      appId,
      overlay: viewInfo.viewType === "overlay",
    });

    // Recalculate all tiles if using tiling and this is a tiled view
    if (viewInfo.mode === "tiled" && _tilingController.isEnabled()) {
      syncTiledLayout({ preferredViewId: viewId });
    }

    // Add to main window's contentView and maintain proper layering
    reorderViewLayers();

    return viewId;
  }

  function removeView(viewId: number): void {
    const viewInfo = _views.get(viewId);
    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    try {
      _tilingController.restoreExpansionForView(viewId);

      // Close DevTools if open
      _devToolsController.closeDevToolsForView(viewInfo.view);

      // Destroy the view safely
      destroyView(viewInfo, _mainWindow);

      // Clean up all event subscriptions for this view

      // Remove from tracking map
      if (_views.delete(viewId)) {
        viewRemoved.emit({
          viewId,
          appId: viewInfo.appId,
          webContentsId: viewInfo.view.webContents.id,
        });
      }

      // Recalculate tiles if using tiling and this was an app view
      if (viewInfo.viewType === "app" && _tilingController.isEnabled()) {
        const visibilityChanged = syncTiledLayout();
        if (visibilityChanged) {
          reorderViewLayers();
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(`Failed to remove view ${viewId}:`, errorMessage);
      // Still remove from tracking even if removal failed
      if (_views.delete(viewId)) {
        viewRemoved.emit({
          viewId,
          appId: viewInfo.appId,
          webContentsId: viewInfo.view.webContents.id,
        });
      }
      throw new Error(`Failed to remove view: ${errorMessage}`);
    }
  }

  function setViewBounds(
    viewId: number,
    bounds: Bounds,
    options: { notify?: boolean } = {},
  ): void {
    const viewInfo = requireView(viewId, _views);
    applyViewBounds(viewId, viewInfo, bounds);

    if (options.notify) {
      boundsUpdated.emit({ viewIds: [viewId], payload: bounds });
    }
  }

  function applyViewBounds(
    viewId: number,
    viewInfo: ViewInfo,
    bounds: Bounds,
  ): void {
    // If this is an overlay view, set bounds directly without constraints
    if (viewInfo.viewType === "overlay") {
      try {
        viewInfo.view.setBounds(bounds);
        viewInfo.bounds = bounds;
        return;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to set overlay bounds: ${errorMessage}`);
      }
    }

    // If this is a tiled view, ignore individual bounds updates
    if (viewInfo.mode === "tiled") {
      log.info(`Ignoring individual bounds update for tiled view ${viewId}`);
      return;
    }

    // For floating views, allow bounds updates
    if (!viewInfo.visible) {
      viewInfo.bounds = bounds;
      return;
    }

    try {
      const windowConfig = viewInfo.manifest.window;
      const finalBounds = _floatingWindows.applyWindowConstraints(
        bounds,
        windowConfig,
        windowConfig?.scaling !== "manual",
      );
      viewInfo.bounds = finalBounds;
      applyPresentedBounds(viewInfo, finalBounds);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to set bounds: ${errorMessage}`);
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
    for (const [, info] of _views.entries()) {
      if (info.view.webContents.id === webContentsId) {
        return info.appId;
      }
    }
    return undefined;
  }

  function getViewIdByWebContentsId(webContentsId: number): number | undefined {
    for (const [viewId, info] of _views.entries()) {
      if (info.view.webContents.id === webContentsId) {
        return viewId;
      }
    }
    return undefined;
  }

  function getAllViews(): [number, ViewInfo][] {
    return Array.from(_views.entries());
  }

  function getTileLayoutState(viewId: number): TileLayoutState {
    requireView(viewId, _views);
    return _tilingController.getTileLayoutState(viewId, _views);
  }

  function swapTiledView(
    viewId: number,
    direction: TileLayoutDirection,
  ): TileLayoutState {
    if (!_tilingController.swapTile(viewId, direction, _views)) {
      throw new Error(`No tiled window is available to swap ${direction}`);
    }
    syncTiledLayout();
    reorderViewLayers();
    return getTileLayoutState(viewId);
  }

  function expandTiledView(
    viewId: number,
    direction: TileLayoutDirection,
  ): TileLayoutState {
    if (!_tilingController.expandTile(viewId, direction, _views)) {
      throw new Error(`The tiled window cannot expand ${direction}`);
    }
    syncTiledLayout();
    reorderViewLayers();
    return getTileLayoutState(viewId);
  }

  function showView(viewId: number): void {
    const viewInfo = requireView(viewId, _views);

    try {
      _tilingController.restoreExpansionForView(viewId);
      viewInfo.requestedVisible = true;
      viewInfo.visible = true;

      if (viewInfo.mode === "tiled") {
        syncTiledLayout({ preferredViewId: viewId });
        reorderViewLayers();
      } else {
        viewInfo.zIndex = _floatingWindows.getNextZIndex();
        reorderViewLayers();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to show view: ${errorMessage}`);
    }
  }

  function focusView(viewId: number): void {
    const viewInfo = requireView(viewId, _views);
    if (viewInfo.view.webContents.isDestroyed()) return;
    viewInfo.view.webContents.focus();
  }

  function hideView(viewId: number): void {
    const viewInfo = requireView(viewId, _views);

    try {
      _tilingController.restoreExpansionForView(viewId);
      viewInfo.requestedVisible = false;
      viewInfo.visible = false;
      viewInfo.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

      if (viewInfo.mode === "tiled") {
        const visibilityChanged = syncTiledLayout({
          excludedViewId: viewId,
        });
        if (visibilityChanged) {
          reorderViewLayers();
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to hide view: ${errorMessage}`);
    }
  }

  function reorderViewLayers(): void {
    if (!isWindowAlive(_mainWindow)) return;

    // Clean up any destroyed views first
    cleanupDestroyedViews(_views);

    try {
      const appViews = Array.from(_views.values()).filter(
        (v) => v.viewType === "app",
      );

      const tiledViews = appViews
        .filter((v) => v.mode === "tiled" && v.visible)
        .sort((a, b) => (a.tileIndex || 0) - (b.tileIndex || 0));

      const floatingAppViews = _floatingWindows
        .getOrderedFloatingViews()
        .filter((v) => v.visible);

      const overlayViews = Array.from(_views.values())
        .filter((v) => v.viewType === "overlay" && v.visible)
        .sort(compareOverlayViews);

      // Remove all views
      for (const info of _views.values()) {
        if (isViewAlive(info.view)) {
          _mainWindow.contentView.removeChildView(info.view);
        }
      }

      // Add back in order: tiled (bottom), floating apps (middle), overlays (top)
      for (const info of tiledViews) {
        if (isViewAlive(info.view)) {
          _mainWindow.contentView.addChildView(info.view);
          applyPresentedBounds(info);
        }
      }

      for (const info of floatingAppViews) {
        if (isViewAlive(info.view)) {
          _mainWindow.contentView.addChildView(info.view);
          applyPresentedBounds(info);
        }
      }

      for (const info of overlayViews) {
        if (isViewAlive(info.view)) {
          _mainWindow.contentView.addChildView(info.view);
          applyPresentedBounds(info);
        }
      }
    } catch (error) {
      log.error("Failed to reorder view layers:", error);
    }
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

  function setViewMode(viewId: number, targetMode?: ViewMode): void {
    const viewInfo = requireView(viewId, _views);
    const manifest = viewInfo.manifest;
    const windowConfig = manifest.window;

    // Determine target mode
    const newMode: ViewMode =
      targetMode || (viewInfo.mode === "floating" ? "tiled" : "floating");

    // Check if the app supports this mode
    if (windowConfig?.mode) {
      if (windowConfig.mode === "floating" && newMode === "tiled") {
        throw new Error(`App ${viewInfo.appId} only supports floating mode`);
      }
      if (windowConfig.mode === "tiled" && newMode === "floating") {
        throw new Error(`App ${viewInfo.appId} only supports tiled mode`);
      }
    }

    // If already in target mode, do nothing
    if (viewInfo.mode === newMode) {
      return;
    }

    log.info(
      `Switching view ${viewId} from ${viewInfo.mode} to ${newMode} mode`,
    );

    try {
      if (newMode === "floating") {
        _tilingController.restoreExpansionForView(viewId);
        viewInfo.tileIndex = undefined;
        const floatingBounds =
          _floatingWindows.calculateInitialBounds(windowConfig);
        viewInfo.bounds = floatingBounds;
        viewInfo.zIndex = _floatingWindows.getNextZIndex();
        viewInfo.mode = "floating";
        applyPresentedBounds(viewInfo, floatingBounds);

        if (_tilingController.isEnabled()) {
          syncTiledLayout();
        }

        reorderViewLayers();
        modeChanged.emit({
          viewIds: [viewId],
          payload: {
            mode: "floating",
            bounds: floatingBounds,
          },
        });
      } else {
        viewInfo.zIndex = undefined;

        if (_tilingController.isEnabled()) {
          viewInfo.tileIndex = _tilingController.getNextTileIndex(
            _views.values(),
          );
          viewInfo.mode = "tiled";
          syncTiledLayout({ preferredViewId: viewId });
          reorderViewLayers();
          modeChanged.emit({
            viewIds: [viewId],
            payload: {
              mode: "tiled",
              bounds: viewInfo.bounds,
            },
          });
        } else {
          const bounds = { ..._tilingController.getWorkspaceBounds() };
          viewInfo.bounds = bounds;
          viewInfo.mode = "tiled";
          applyPresentedBounds(viewInfo, bounds);
          reorderViewLayers();
          modeChanged.emit({
            viewIds: [viewId],
            payload: {
              mode: "tiled",
              bounds,
            },
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to switch mode: ${errorMessage}`);
    }
  }

  function getCurrentScale(): number {
    return _scaleController.getScale();
  }

  function setInterfaceScale(scale: number): void {
    _scaleController.setScale(scale);
  }

  function setKeyboardPresentationLift(lift: number): void {
    if (!_presentationController.setViewLift(lift)) {
      return;
    }

    reapplyPresentedBounds();
  }

  function getKeyboardPresentationLift(): number {
    return _presentationController.getViewLift();
  }

  function applyPresentedBounds(
    viewInfo: ViewInfo,
    bounds = viewInfo.bounds,
  ): void {
    viewInfo.view.setBounds(_presentationController.applyToBounds(bounds));
  }

  function reapplyPresentedBounds(): void {
    for (const info of _views.values()) {
      if (!info.visible || !isViewAlive(info.view)) {
        continue;
      }

      applyPresentedBounds(info);
    }
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
    _mainWindow = null;
  }
  yield* Effect.addFinalizer(() => Effect.sync(dispose));
  return {
    initialize: _scaleController.initialize,
    viewRemoved,
    viewLoaded,
    viewLoadFailed,
    interfaceScaleChanged,
    globalBoundsChanged,
    boundsUpdated,
    modeChanged,
    setMainWindow,
    updateGlobalBounds,
    setWorkspaceBounds,
    setWindowSize,
    getWindowSize,
    createView,
    removeView,
    setViewBounds,
    getView,
    getViewInfo,
    getViewsByAppId,
    getAppIdByWebContentsId,
    getViewIdByWebContentsId,
    getAllViews,
    getTileLayoutState,
    swapTiledView,
    expandTiledView,
    showView,
    focusView,
    hideView,
    sendToView,
    sendToMainWindow,
    getActiveViews,
    setViewMode,
    getCurrentScale,
    setInterfaceScale,
    setKeyboardPresentationLift,
    getKeyboardPresentationLift,
  };
});

export type ViewManager = Effect.Success<ReturnType<typeof createViewManager>>;

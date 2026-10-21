import type {
  TileLayoutDirection,
  TileLayoutState,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import type { TargetedNotification } from "../controllers/events";
import type { Event } from "../events/event";
import { log } from "../logging/logger";
import type { Bounds } from "../platform/ports/types";
import {
  callViewNative,
  TileActionUnavailable,
  ViewModeUnsupported,
} from "./errors";
import type { FloatingWindows } from "./floating-windows";
import { isViewAlive, isWindowAlive, requireView } from "./lifecycle";
import type { ViewPresentation } from "./presentation";
import type { ViewRegistry } from "./registry";
import type { Tiling } from "./tiling";
import {
  compareOverlayViews,
  type ViewInfo,
  type ViewMode,
  type ViewsEvents,
} from "./types";

export interface ViewLayout {
  restoreExpansionForView(viewId: number): void;
  isTilingEnabled(): boolean;
  handleInterfaceScaleChanged(scale: number, previousScale: number): void;
  updateGlobalBounds: (bounds: ViewBounds, windowSize: WindowSize) => void;
  setWorkspaceBounds: (bounds: Bounds) => void;
  syncTiledLayout(options?: {
    preferredViewId?: number;
    excludedViewId?: number;
  }): boolean;
  setWindowSize: (windowSize: WindowSize) => void;
  getWindowSize: () => WindowSize;
  setViewBounds: (
    viewId: number,
    bounds: Bounds,
    options?: { notify?: boolean },
  ) => void;
  getTileLayoutState: (viewId: number) => TileLayoutState;
  swapTiledView: (
    viewId: number,
    direction: TileLayoutDirection,
  ) => TileLayoutState;
  expandTiledView: (
    viewId: number,
    direction: TileLayoutDirection,
  ) => TileLayoutState;
  showView: (viewId: number) => void;
  hideView: (viewId: number) => void;
  reorderViewLayers(): void;
  setViewMode: (viewId: number, targetMode?: ViewMode) => void;
  setKeyboardPresentationLift: (lift: number) => void;
  getKeyboardPresentationLift: () => number;
}

export function createViewLayout(
  registry: ViewRegistry,
  _tiling: Tiling,
  _floatingWindows: FloatingWindows,
  _presentation: ViewPresentation,
  events: {
    interfaceScaleChanged: Event<ViewsEvents["interface-scale-changed"]>;
    globalBoundsChanged: Event<ViewsEvents["global-bounds-changed"]>;
    boundsUpdated: Event<TargetedNotification<ViewBounds>>;
    modeChanged: Event<TargetedNotification<ViewsEvents["mode-changed"]>>;
  },
): ViewLayout {
  const _views = registry.views;
  const {
    interfaceScaleChanged,
    globalBoundsChanged,
    boundsUpdated,
    modeChanged,
  } = events;
  let _windowSize: WindowSize = { width: 800, height: 600 };
  function handleInterfaceScaleChanged(
    scale: number,
    previousScale: number,
  ): void {
    interfaceScaleChanged.emit({ scale });

    if (scale === previousScale) {
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
    _tiling.setWorkspaceBounds(bounds);
    if (_tiling.isEnabled()) {
      const visibilityChanged = syncTiledLayout();
      if (visibilityChanged) {
        reorderViewLayers();
      }
    }
  }

  function syncTiledLayout(
    options: { preferredViewId?: number; excludedViewId?: number } = {},
  ): boolean {
    const { toHide, toShow } = _tiling.resolveTiledVisibilityChanges(
      _views,
      options,
    );

    let visibilityChanged = false;

    for (const viewId of toHide) {
      const viewInfo = _views.get(viewId);
      if (!viewInfo?.visible) continue;

      _tiling.restoreExpansionForView(viewId);
      viewInfo.visible = false;
      viewInfo.bounds = { x: 0, y: 0, width: 0, height: 0 };

      if (!viewInfo.view.webContents.isDestroyed()) {
        callViewNative("set-bounds", viewInfo, () =>
          viewInfo.view.setBounds(viewInfo.bounds),
        );
      }

      visibilityChanged = true;
    }

    for (const viewId of toShow) {
      const viewInfo = _views.get(viewId);
      if (!viewInfo || viewInfo.visible) continue;

      viewInfo.visible = true;
      visibilityChanged = true;
    }

    _tiling.recalculateTiledViews(_views);
    reapplyPresentedBounds();
    return visibilityChanged;
  }

  function setWindowSize(windowSize: WindowSize): void {
    _windowSize = windowSize;
  }

  function getWindowSize(): WindowSize {
    return _windowSize;
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
      callViewNative("set-bounds", viewInfo, () =>
        viewInfo.view.setBounds(bounds),
      );
      viewInfo.bounds = bounds;
      return;
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
    const windowConfig = viewInfo.manifest.window;
    const finalBounds = _floatingWindows.applyWindowConstraints(
      bounds,
      windowConfig,
      windowConfig?.scaling !== "manual",
    );
    viewInfo.bounds = finalBounds;
    applyPresentedBounds(viewInfo, finalBounds);
  }

  function getTileLayoutState(viewId: number): TileLayoutState {
    requireView(viewId, _views);
    return _tiling.getTileLayoutState(viewId, _views);
  }

  function swapTiledView(
    viewId: number,
    direction: TileLayoutDirection,
  ): TileLayoutState {
    if (!_tiling.swapTile(viewId, direction, _views)) {
      throw new TileActionUnavailable({ viewId, action: "swap", direction });
    }
    syncTiledLayout();
    reorderViewLayers();
    return getTileLayoutState(viewId);
  }

  function expandTiledView(
    viewId: number,
    direction: TileLayoutDirection,
  ): TileLayoutState {
    if (!_tiling.expandTile(viewId, direction, _views)) {
      throw new TileActionUnavailable({ viewId, action: "expand", direction });
    }
    syncTiledLayout();
    reorderViewLayers();
    return getTileLayoutState(viewId);
  }

  function showView(viewId: number): void {
    const viewInfo = requireView(viewId, _views);
    _tiling.restoreExpansionForView(viewId);
    viewInfo.requestedVisible = true;
    viewInfo.visible = true;

    if (viewInfo.mode === "tiled") {
      syncTiledLayout({ preferredViewId: viewId });
      reorderViewLayers();
    } else {
      viewInfo.zIndex = _floatingWindows.getNextZIndex();
      reorderViewLayers();
    }
  }

  function hideView(viewId: number): void {
    const viewInfo = requireView(viewId, _views);
    _tiling.restoreExpansionForView(viewId);
    viewInfo.requestedVisible = false;
    viewInfo.visible = false;
    callViewNative("set-bounds", viewInfo, () =>
      viewInfo.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }),
    );

    if (viewInfo.mode === "tiled") {
      const visibilityChanged = syncTiledLayout({
        excludedViewId: viewId,
      });
      if (visibilityChanged) {
        reorderViewLayers();
      }
    }
  }

  function reorderViewLayers(): void {
    const _mainWindow = registry.getMainWindow();
    if (!isWindowAlive(_mainWindow)) return;

    // Clean up any destroyed views first
    registry.cleanupDestroyed();

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
        throw new ViewModeUnsupported({
          viewId,
          appId: viewInfo.appId,
          supportedMode: "floating",
          requestedMode: newMode,
        });
      }
      if (windowConfig.mode === "tiled" && newMode === "floating") {
        throw new ViewModeUnsupported({
          viewId,
          appId: viewInfo.appId,
          supportedMode: "tiled",
          requestedMode: newMode,
        });
      }
    }

    // If already in target mode, do nothing
    if (viewInfo.mode === newMode) {
      return;
    }

    log.info(
      `Switching view ${viewId} from ${viewInfo.mode} to ${newMode} mode`,
    );
    if (newMode === "floating") {
      _tiling.restoreExpansionForView(viewId);
      viewInfo.tileIndex = undefined;
      const floatingBounds =
        _floatingWindows.calculateInitialBounds(windowConfig);
      viewInfo.bounds = floatingBounds;
      viewInfo.zIndex = _floatingWindows.getNextZIndex();
      viewInfo.mode = "floating";
      applyPresentedBounds(viewInfo, floatingBounds);

      if (_tiling.isEnabled()) {
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

      if (_tiling.isEnabled()) {
        viewInfo.tileIndex = _tiling.getNextTileIndex(_views.values());
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
        const bounds = { ..._tiling.getWorkspaceBounds() };
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
  }

  function setKeyboardPresentationLift(lift: number): void {
    if (!_presentation.setViewLift(lift)) {
      return;
    }

    reapplyPresentedBounds();
  }

  function getKeyboardPresentationLift(): number {
    return _presentation.getViewLift();
  }

  function applyPresentedBounds(
    viewInfo: ViewInfo,
    bounds = viewInfo.bounds,
  ): void {
    const presented = _presentation.applyToBounds(bounds);
    callViewNative("set-bounds", viewInfo, () =>
      viewInfo.view.setBounds(presented),
    );
  }

  function reapplyPresentedBounds(): void {
    for (const info of _views.values()) {
      if (!info.visible || !isViewAlive(info.view)) {
        continue;
      }

      applyPresentedBounds(info);
    }
  }

  return {
    restoreExpansionForView: _tiling.restoreExpansionForView,
    isTilingEnabled: _tiling.isEnabled,
    handleInterfaceScaleChanged,
    updateGlobalBounds,
    setWorkspaceBounds,
    syncTiledLayout,
    setWindowSize,
    getWindowSize,
    setViewBounds,
    getTileLayoutState,
    swapTiledView,
    expandTiledView,
    showView,
    hideView,
    reorderViewLayers,
    setViewMode,
    setKeyboardPresentationLift,
    getKeyboardPresentationLift,
  };
}

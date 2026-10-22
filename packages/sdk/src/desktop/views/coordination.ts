import type {
  TileLayoutDirection,
  TileLayoutState,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import type { TargetedNotification } from "../../core/controllers/events";
import type { Event } from "../../core/events/event";
import { log } from "../../platform/logging/logger";
import type { Bounds } from "../../platform/ports/types";
import {
  callViewNative,
  TileActionUnavailable,
  type ViewModeError,
  ViewModeUnsupported,
  type ViewMutationError,
  type ViewNativeFailure,
  type ViewTileError,
} from "./errors";
import type { FloatingWindows } from "./floating-windows";
import { findView, isViewAlive, isWindowAlive, requireView } from "./lifecycle";
import type { ViewPresentation } from "./presentation";
import type { ViewRegistry } from "./registry";
import type { Tiling } from "./tiling";
import {
  compareOverlayViews,
  type ViewEvents,
  type ViewInfo,
  type ViewMode,
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
  }): Result.Result<boolean, ViewNativeFailure>;
  setWindowSize: (windowSize: WindowSize) => void;
  getWindowSize: () => WindowSize;
  setViewBounds: (
    viewId: number,
    bounds: Bounds,
    options?: { notify?: boolean },
  ) => Effect.Effect<void, ViewMutationError>;
  getTileLayoutState: (viewId: number) => TileLayoutState;
  swapTiledView: (
    viewId: number,
    direction: TileLayoutDirection,
  ) => Effect.Effect<TileLayoutState, ViewTileError>;
  expandTiledView: (
    viewId: number,
    direction: TileLayoutDirection,
  ) => Effect.Effect<TileLayoutState, ViewTileError>;
  showView: (viewId: number) => Effect.Effect<void, ViewMutationError>;
  hideView: (viewId: number) => Effect.Effect<void, ViewMutationError>;
  reorderViewLayers(): void;
  setViewMode: (
    viewId: number,
    targetMode?: ViewMode,
  ) => Effect.Effect<void, ViewModeError>;
  setKeyboardPresentationLift: (lift: number) => void;
  getKeyboardPresentationLift: () => number;
}

export function createViewLayout(
  registry: ViewRegistry,
  _tiling: Tiling,
  _floatingWindows: FloatingWindows,
  _presentation: ViewPresentation,
  events: {
    interfaceScaleChanged: Event<ViewEvents["interface-scale-changed"]>;
    globalBoundsChanged: Event<ViewEvents["global-bounds-changed"]>;
    boundsUpdated: Event<TargetedNotification<ViewBounds>>;
    modeChanged: Event<TargetedNotification<ViewEvents["mode-changed"]>>;
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
        Result.getOrThrow(applyPresentedBounds(viewInfo, finalBounds));
      }
    }

    Result.getOrThrow(syncTiledLayout());
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
      const visibilityChanged = Result.getOrThrow(syncTiledLayout());
      if (visibilityChanged) {
        reorderViewLayers();
      }
    }
  }

  function syncTiledLayout(
    options: { preferredViewId?: number; excludedViewId?: number } = {},
  ) {
    return Result.gen(function* () {
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
          yield* callViewNative("set-bounds", viewInfo, () =>
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

      yield* _tiling.recalculateTiledViews(_views);
      yield* reapplyPresentedBounds();
      return visibilityChanged;
    });
  }

  function setWindowSize(windowSize: WindowSize): void {
    _windowSize = windowSize;
  }

  function getWindowSize(): WindowSize {
    return _windowSize;
  }

  const setViewBounds = Effect.fn(function* (
    viewId: number,
    bounds: Bounds,
    options: { notify?: boolean } = {},
  ) {
    const viewInfo = yield* Effect.fromResult(findView(viewId, _views));
    if (viewInfo.viewType === "overlay") {
      yield* Effect.fromResult(
        callViewNative("set-bounds", viewInfo, () =>
          viewInfo.view.setBounds(bounds),
        ),
      );
      viewInfo.bounds = bounds;
    } else if (viewInfo.mode === "tiled") {
      log.info(`Ignoring individual bounds update for tiled view ${viewId}`);
    } else if (!viewInfo.visible) {
      viewInfo.bounds = bounds;
    } else {
      const windowConfig = viewInfo.manifest.window;
      viewInfo.bounds = _floatingWindows.applyWindowConstraints(
        bounds,
        windowConfig,
        windowConfig?.scaling !== "manual",
      );
      yield* Effect.fromResult(applyPresentedBounds(viewInfo));
    }
    if (options.notify)
      boundsUpdated.emit({ viewIds: [viewId], payload: bounds });
  });

  function getTileLayoutState(viewId: number): TileLayoutState {
    requireView(viewId, _views);
    return _tiling.getTileLayoutState(viewId, _views);
  }

  const swapTiledView = Effect.fn(function* (
    viewId: number,
    direction: TileLayoutDirection,
  ) {
    yield* Effect.fromResult(findView(viewId, _views));
    if (!_tiling.swapTile(viewId, direction, _views)) {
      return yield* Effect.fail(
        new TileActionUnavailable({ viewId, action: "swap", direction }),
      );
    }
    yield* Effect.fromResult(syncTiledLayout());
    reorderViewLayers();
    return _tiling.getTileLayoutState(viewId, _views);
  });

  const expandTiledView = Effect.fn(function* (
    viewId: number,
    direction: TileLayoutDirection,
  ) {
    yield* Effect.fromResult(findView(viewId, _views));
    if (!_tiling.expandTile(viewId, direction, _views)) {
      return yield* Effect.fail(
        new TileActionUnavailable({ viewId, action: "expand", direction }),
      );
    }
    yield* Effect.fromResult(syncTiledLayout());
    reorderViewLayers();
    return _tiling.getTileLayoutState(viewId, _views);
  });

  const showView = Effect.fn(function* (viewId: number) {
    const viewInfo = yield* Effect.fromResult(findView(viewId, _views));
    _tiling.restoreExpansionForView(viewId);
    viewInfo.requestedVisible = true;
    viewInfo.visible = true;

    if (viewInfo.mode === "tiled") {
      yield* Effect.fromResult(syncTiledLayout({ preferredViewId: viewId }));
      reorderViewLayers();
    } else {
      viewInfo.zIndex = _floatingWindows.getNextZIndex();
      reorderViewLayers();
    }
  });

  const hideView = Effect.fn(function* (viewId: number) {
    const viewInfo = yield* Effect.fromResult(findView(viewId, _views));
    _tiling.restoreExpansionForView(viewId);
    viewInfo.requestedVisible = false;
    viewInfo.visible = false;
    yield* Effect.fromResult(
      callViewNative("set-bounds", viewInfo, () =>
        viewInfo.view.setBounds({ x: 0, y: 0, width: 0, height: 0 }),
      ),
    );

    if (viewInfo.mode === "tiled") {
      const visibilityChanged = yield* Effect.fromResult(
        syncTiledLayout({ excludedViewId: viewId }),
      );
      if (visibilityChanged) {
        reorderViewLayers();
      }
    }
  });

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
          Result.getOrThrow(applyPresentedBounds(info));
        }
      }

      for (const info of floatingAppViews) {
        if (isViewAlive(info.view)) {
          _mainWindow.contentView.addChildView(info.view);
          Result.getOrThrow(applyPresentedBounds(info));
        }
      }

      for (const info of overlayViews) {
        if (isViewAlive(info.view)) {
          _mainWindow.contentView.addChildView(info.view);
          Result.getOrThrow(applyPresentedBounds(info));
        }
      }
    } catch (error) {
      log.error("Failed to reorder view layers:", error);
    }
  }

  const setViewMode = Effect.fn(function* (
    viewId: number,
    targetMode?: ViewMode,
  ) {
    const viewInfo = yield* Effect.fromResult(findView(viewId, _views));
    const manifest = viewInfo.manifest;
    const windowConfig = manifest.window;

    // Determine target mode
    const newMode: ViewMode =
      targetMode || (viewInfo.mode === "floating" ? "tiled" : "floating");

    const supportedMode = windowConfig?.mode;
    if (supportedMode && supportedMode !== "both" && supportedMode !== newMode)
      return yield* Effect.fail(
        new ViewModeUnsupported({
          viewId,
          appId: viewInfo.appId,
          supportedMode,
          requestedMode: newMode,
        }),
      );

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
      yield* Effect.fromResult(applyPresentedBounds(viewInfo, floatingBounds));

      if (_tiling.isEnabled()) {
        yield* Effect.fromResult(syncTiledLayout());
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
        yield* Effect.fromResult(syncTiledLayout({ preferredViewId: viewId }));
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
        yield* Effect.fromResult(applyPresentedBounds(viewInfo, bounds));
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
  });

  function setKeyboardPresentationLift(lift: number): void {
    if (!_presentation.setViewLift(lift)) {
      return;
    }

    Result.getOrThrow(reapplyPresentedBounds());
  }

  function getKeyboardPresentationLift(): number {
    return _presentation.getViewLift();
  }

  function applyPresentedBounds(viewInfo: ViewInfo, bounds = viewInfo.bounds) {
    const presented = _presentation.applyToBounds(bounds);
    return callViewNative("set-bounds", viewInfo, () =>
      viewInfo.view.setBounds(presented),
    );
  }

  function reapplyPresentedBounds() {
    return Result.gen(function* () {
      for (const info of _views.values()) {
        if (!info.visible || !isViewAlive(info.view)) {
          continue;
        }

        yield* applyPresentedBounds(info);
      }
    });
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

import type {
  AppManifest,
  FilesystemLocation,
  TileLayoutDirection,
  TileLayoutState,
  ViewBounds,
  WindowSize,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { TargetedNotification } from "../../core/controllers/events";
import type { Event } from "../../core/events/event";
import { scopedEvent } from "../../core/events/scoped";
import { Settings } from "../../core/settings/service";
import {
  type Bounds,
  type PlatformView,
  type PlatformWindow,
  WindowingPort,
} from "../../platform/ports/types";
import { DistPath, RuntimeConfig } from "../../runtime/inputs";
import { createViewLayout, type ViewLayout } from "./coordination";
import { createViewDevTools } from "./devtools";
import type {
  ViewCreateError,
  ViewModeError,
  ViewMutationError,
  ViewTileError,
} from "./errors";
import { createFloatingWindows } from "./floating-windows";
import { createInterfaceScale } from "./interface-scale";
import { createViewPresentation } from "./presentation";
import { createViewRegistry, type ViewRegistry } from "./registry";
import { createViewRendering } from "./rendering";
import { createTiling } from "./tiling";
import type { ViewEvents, ViewInfo, ViewMode } from "./types";

/** Native setup and presentation hooks are synchronous; workflows return lazy Effects. */
export interface Views {
  initialize: () => Effect.Effect<void>;
  viewRemoved: Event<ViewEvents["view-removed"]>;
  viewLoaded: Event<ViewEvents["view-loaded"]>;
  viewLoadFailed: Event<ViewEvents["view-load-failed"]>;
  interfaceScaleChanged: Event<ViewEvents["interface-scale-changed"]>;
  globalBoundsChanged: Event<ViewEvents["global-bounds-changed"]>;
  boundsUpdated: Event<TargetedNotification<ViewBounds>>;
  modeChanged: Event<TargetedNotification<ViewEvents["mode-changed"]>>;
  setMainWindow: (window: PlatformWindow) => void;
  updateGlobalBounds: (bounds: ViewBounds, windowSize: WindowSize) => void;
  setWorkspaceBounds: (bounds: Bounds) => void;
  setWindowSize: (windowSize: WindowSize) => void;
  getWindowSize: () => WindowSize;
  createView: (
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ) => Effect.Effect<number, ViewCreateError>;
  /** Releases native ownership and indexes even when layout cleanup fails. */
  removeView: (viewId: number) => Effect.Effect<void, ViewMutationError>;
  setViewBounds: (
    viewId: number,
    bounds: Bounds,
    options?: { notify?: boolean },
  ) => Effect.Effect<void, ViewMutationError>;
  getView: (viewId: number) => PlatformView | undefined;
  getViewInfo: (viewId: number) => ViewInfo | undefined;
  getViewsByAppId: (appId: string) => number[];
  getAppIdByWebContentsId: (webContentsId: number) => string | undefined;
  getViewIdByWebContentsId: (webContentsId: number) => number | undefined;
  getAllViews: () => [number, ViewInfo][];
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
  focusView: (viewId: number) => Effect.Effect<void, ViewMutationError>;
  hideView: (viewId: number) => Effect.Effect<void, ViewMutationError>;
  sendToView: (viewId: number, channel: string, ...args: unknown[]) => boolean;
  sendToMainWindow: (channel: string, ...args: unknown[]) => boolean;
  getActiveViews: () => number[];
  setViewMode: (
    viewId: number,
    targetMode?: ViewMode,
  ) => Effect.Effect<void, ViewModeError>;
  getCurrentScale: () => number;
  setInterfaceScale: (scale: number) => void;
  setKeyboardPresentationLift: (lift: number) => void;
  getKeyboardPresentationLift: () => number;
}

export const Views = Context.Service<"eden/Views", Views>("eden/Views");

export const ViewsLive = Layer.effect(
  Views,
  Effect.gen(function* () {
    const config = yield* RuntimeConfig;
    const distPath = yield* DistPath;
    const settings = yield* Settings;
    const windows = yield* WindowingPort;
    const viewRemoved = yield* scopedEvent<ViewEvents["view-removed"]>();
    const viewLoaded = yield* scopedEvent<ViewEvents["view-loaded"]>();
    const viewLoadFailed = yield* scopedEvent<ViewEvents["view-load-failed"]>();
    const interfaceScaleChanged =
      yield* scopedEvent<ViewEvents["interface-scale-changed"]>();
    const globalBoundsChanged =
      yield* scopedEvent<ViewEvents["global-bounds-changed"]>();
    const boundsUpdated =
      yield* scopedEvent<TargetedNotification<ViewBounds>>();
    const modeChanged =
      yield* scopedEvent<TargetedNotification<ViewEvents["mode-changed"]>>();
    let registry: ViewRegistry | undefined;
    let layout: ViewLayout | undefined;
    const getViews = () => registry?.views.values() ?? [];
    const devtools = createViewDevTools();
    const presentation = createViewPresentation();
    const interfaceScale = yield* createInterfaceScale(
      settings,
      getViews,
      (scale, previousScale) => {
        if (layout) layout.handleInterfaceScaleChanged(scale, previousScale);
        else interfaceScaleChanged.emit({ scale });
      },
    );
    const tiling = createTiling(
      config.tiling || { mode: "none", gap: 0, padding: 0 },
      undefined,
      interfaceScale.getScale,
    );
    const floatingWindows = createFloatingWindows(
      () => tiling.getWorkspaceBounds(),
      getViews,
      interfaceScale.getScale,
    );
    const rendering = yield* createViewRendering(
      distPath,
      tiling,
      floatingWindows,
      windows,
    );
    const nativeViews = createViewRegistry(
      windows,
      rendering,
      interfaceScale,
      devtools,
      { viewRemoved, viewLoaded, viewLoadFailed },
    );
    registry = nativeViews;
    const coordination = createViewLayout(
      nativeViews,
      tiling,
      floatingWindows,
      presentation,
      {
        interfaceScaleChanged,
        globalBoundsChanged,
        boundsUpdated,
        modeChanged,
      },
    );
    layout = coordination;
    yield* Effect.addFinalizer(() => Effect.sync(nativeViews.dispose));
    return {
      setMainWindow: nativeViews.setMainWindow,
      updateGlobalBounds: coordination.updateGlobalBounds,
      setWorkspaceBounds: coordination.setWorkspaceBounds,
      setWindowSize: coordination.setWindowSize,
      getWindowSize: coordination.getWindowSize,
      setViewBounds: coordination.setViewBounds,
      getView: nativeViews.getView,
      getViewInfo: nativeViews.getViewInfo,
      getViewsByAppId: nativeViews.getViewsByAppId,
      getAppIdByWebContentsId: nativeViews.getAppIdByWebContentsId,
      getViewIdByWebContentsId: nativeViews.getViewIdByWebContentsId,
      getAllViews: nativeViews.getAllViews,
      getTileLayoutState: coordination.getTileLayoutState,
      swapTiledView: coordination.swapTiledView,
      expandTiledView: coordination.expandTiledView,
      showView: coordination.showView,
      focusView: nativeViews.focusView,
      hideView: coordination.hideView,
      sendToView: nativeViews.sendToView,
      sendToMainWindow: nativeViews.sendToMainWindow,
      getActiveViews: nativeViews.getActiveViews,
      setViewMode: coordination.setViewMode,
      setKeyboardPresentationLift: coordination.setKeyboardPresentationLift,
      getKeyboardPresentationLift: coordination.getKeyboardPresentationLift,
      initialize: interfaceScale.initialize,
      viewRemoved,
      viewLoaded,
      viewLoadFailed,
      interfaceScaleChanged,
      globalBoundsChanged,
      boundsUpdated,
      modeChanged,
      createView: (...args) => nativeViews.createView(coordination, ...args),
      removeView: (viewId) => nativeViews.removeView(coordination, viewId),
      getCurrentScale: interfaceScale.getScale,
      setInterfaceScale: interfaceScale.setScale,
    } satisfies Views;
  }).pipe(Effect.tap((value) => value.initialize())),
);

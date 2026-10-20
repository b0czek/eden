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
import type { TargetedNotification } from "../controllers/events";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import type { Bounds, PlatformView, PlatformWindow } from "../platform/ports";
import { WindowingPort } from "../platform/ports/types";
import { DistPath, RuntimeConfig } from "../runtime/inputs";
import { Settings } from "../settings/service";
import { createViewLayout, type ViewLayout } from "./coordination";
import { createViewDevTools } from "./devtools";
import { createFloatingWindows } from "./floating-windows";
import { createInterfaceScale } from "./interface-scale";
import { createViewPresentation } from "./presentation";
import { createViewRegistry, type ViewRegistry } from "./registry";
import { createViewRendering } from "./rendering";
import { createTiling } from "./tiling";
import type { ViewInfo, ViewMode, ViewsEvents } from "./types";

/** Mutations reject synchronously with the contextual tagged errors in errors.ts. */
export interface Views {
  initialize: () => Effect.Effect<void>;
  viewRemoved: Event<ViewsEvents["view-removed"]>;
  viewLoaded: Event<ViewsEvents["view-loaded"]>;
  viewLoadFailed: Event<ViewsEvents["view-load-failed"]>;
  interfaceScaleChanged: Event<ViewsEvents["interface-scale-changed"]>;
  globalBoundsChanged: Event<ViewsEvents["global-bounds-changed"]>;
  boundsUpdated: Event<TargetedNotification<ViewBounds>>;
  modeChanged: Event<TargetedNotification<ViewsEvents["mode-changed"]>>;
  setMainWindow: (window: PlatformWindow) => void;
  updateGlobalBounds: (bounds: ViewBounds, windowSize: WindowSize) => void;
  setWorkspaceBounds: (bounds: Bounds) => void;
  setWindowSize: (windowSize: WindowSize) => void;
  getWindowSize: () => WindowSize;
  /** @throws MainWindowUnavailable, ViewNativeFailure. Missing frontend is a caller defect. */
  createView: (
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ) => number;
  /** @throws ViewUnavailable or ViewNativeFailure; indexes are released on failure. */
  removeView: (viewId: number) => void;
  /** @throws ViewUnavailable or ViewNativeFailure. */
  setViewBounds: (
    viewId: number,
    bounds: Bounds,
    options?: { notify?: boolean },
  ) => void;
  getView: (viewId: number) => PlatformView | undefined;
  getViewInfo: (viewId: number) => ViewInfo | undefined;
  getViewsByAppId: (appId: string) => number[];
  getAppIdByWebContentsId: (webContentsId: number) => string | undefined;
  getViewIdByWebContentsId: (webContentsId: number) => number | undefined;
  getAllViews: () => [number, ViewInfo][];
  getTileLayoutState: (viewId: number) => TileLayoutState;
  /** @throws TileActionUnavailable, ViewUnavailable, or ViewNativeFailure. */
  swapTiledView: (
    viewId: number,
    direction: TileLayoutDirection,
  ) => TileLayoutState;
  /** @throws TileActionUnavailable, ViewUnavailable, or ViewNativeFailure. */
  expandTiledView: (
    viewId: number,
    direction: TileLayoutDirection,
  ) => TileLayoutState;
  showView: (viewId: number) => void;
  focusView: (viewId: number) => void;
  hideView: (viewId: number) => void;
  sendToView: (viewId: number, channel: string, ...args: unknown[]) => boolean;
  sendToMainWindow: (channel: string, ...args: unknown[]) => boolean;
  getActiveViews: () => number[];
  /** @throws ViewUnavailable, ViewModeUnsupported, or ViewNativeFailure. */
  setViewMode: (viewId: number, targetMode?: ViewMode) => void;
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
    const viewRemoved = yield* scopedEvent<ViewsEvents["view-removed"]>();
    const viewLoaded = yield* scopedEvent<ViewsEvents["view-loaded"]>();
    const viewLoadFailed =
      yield* scopedEvent<ViewsEvents["view-load-failed"]>();
    const interfaceScaleChanged =
      yield* scopedEvent<ViewsEvents["interface-scale-changed"]>();
    const globalBoundsChanged =
      yield* scopedEvent<ViewsEvents["global-bounds-changed"]>();
    const boundsUpdated =
      yield* scopedEvent<TargetedNotification<ViewBounds>>();
    const modeChanged =
      yield* scopedEvent<TargetedNotification<ViewsEvents["mode-changed"]>>();
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

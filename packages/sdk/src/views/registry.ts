import type { AppManifest, FilesystemLocation } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Result from "effect/Result";
import type { Event } from "../events/event";
import { log } from "../logging/logger";
import type {
  Bounds,
  PlatformView,
  PlatformWindow,
  WindowingPort,
} from "../platform/ports/types";
import type { ViewLayout } from "./coordination";
import type { ViewDevTools } from "./devtools";
import {
  callViewNative,
  MainWindowUnavailable,
  type ViewCreateError,
  type ViewMutationError,
  ViewUnavailable,
} from "./errors";
import type { InterfaceScale } from "./interface-scale";
import {
  cleanupDestroyedViews,
  destroyView,
  findView,
  isWindowAlive,
  requireView,
} from "./lifecycle";
import type { ViewRendering } from "./rendering";
import type { Views } from "./service";
import type { ViewEvents, ViewInfo } from "./types";

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
  focusView(viewId: number): Effect.Effect<void, ViewMutationError>;
  getMainWindow(): PlatformWindow | null;
  createView(
    layout: ViewLifecycleLayout,
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ): Effect.Effect<number, ViewCreateError>;
  removeView(
    layout: ViewLifecycleLayout,
    viewId: number,
  ): Effect.Effect<void, ViewMutationError>;
  cleanupDestroyed(): void;
  dispose(): void;
}

export function createViewRegistry(
  _windows: WindowingPort,
  _rendering: ViewRendering,
  _interfaceScale: InterfaceScale,
  _devtools: ViewDevTools,
  events: {
    viewRemoved: Event<ViewEvents["view-removed"]>;
    viewLoaded: Event<ViewEvents["view-loaded"]>;
    viewLoadFailed: Event<ViewEvents["view-load-failed"]>;
  },
): ViewRegistry {
  const _views = new Map<number, ViewInfo>();
  const _viewsByWebContentsId = new Map<number, ViewInfo>();
  let _mainWindow: PlatformWindow | null = null;
  const { viewRemoved, viewLoaded, viewLoadFailed } = events;
  function markViewFocused(viewInfo: ViewInfo): void {
    viewInfo.lastFocusedAt = Date.now();
  }

  function attachFocusTracking(viewId: number, viewInfo: ViewInfo) {
    return callViewNative("register", viewInfo, () => {
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

  const createView = Effect.fn(function* (
    layout: ViewLifecycleLayout,
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ) {
    if (!isWindowAlive(_mainWindow))
      return yield* Effect.fail(new MainWindowUnavailable({ appId }));
    const viewInfo = yield* _rendering.createView(
      appId,
      manifest,
      installPath,
      bounds,
      _views.values(),
      launchArgs,
      launchFile,
    );
    return yield* Effect.gen(function* () {
      const viewId = viewInfo.id;
      yield* Effect.fromResult(
        callViewNative("register", viewInfo, () => {
          _windows.attachWebContentsLogger(viewInfo.view.webContents, {
            appId,
            viewId,
            source: viewInfo.viewType === "overlay" ? "overlay" : "app",
          });
        }),
      );
      _views.set(viewId, viewInfo);
      _viewsByWebContentsId.set(viewInfo.view.webContents.id, viewInfo);
      yield* Effect.fromResult(attachFocusTracking(viewId, viewInfo));
      _interfaceScale.applyToView(viewInfo);
      yield* Effect.fromResult(
        callViewNative("register", viewInfo, () =>
          _devtools.registerShortcut(viewInfo.view),
        ),
      );
      yield* Effect.fromResult(
        callViewNative("register", viewInfo, () => {
          viewInfo.view.webContents.on("did-finish-load", () =>
            _interfaceScale.applyToView(viewInfo),
          );
          viewInfo.view.webContents.on(
            "did-fail-load",
            (_event, errorCode: number, errorDescription: string) => {
              log.error(`View load failed for ${appId}:`, errorDescription);
              viewLoadFailed.emit({
                viewId,
                appId,
                errorCode,
                errorDescription,
              });
            },
          );
        }),
      );
      viewLoaded.emit({
        viewId,
        appId,
        overlay: viewInfo.viewType === "overlay",
      });
      if (viewInfo.mode === "tiled" && layout.isTilingEnabled())
        yield* Effect.fromResult(
          layout.syncTiledLayout({ preferredViewId: viewId }),
        );
      layout.reorderViewLayers();
      return viewId;
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? _views.has(viewInfo.id)
            ? removeNativeView(layout, viewInfo)
            : Effect.fromResult(destroyView(viewInfo, _mainWindow))
          : Effect.void,
      ),
    );
  }, Effect.uninterruptible);

  const removeView = Effect.fn(function* (
    layout: ViewLifecycleLayout,
    viewId: number,
  ) {
    const viewInfo = _views.get(viewId);
    if (!viewInfo)
      return yield* Effect.fail(
        new ViewUnavailable({ viewId, reason: "missing" }),
      );
    yield* removeNativeView(layout, viewInfo);
  }, Effect.uninterruptible);

  const removeNativeView = Effect.fn(function* (
    layout: ViewLifecycleLayout,
    viewInfo: ViewInfo,
  ) {
    const viewId = viewInfo.id;
    const webContentsId = viewInfo.view.webContents.id;
    yield* Effect.sync(() => {
      layout.restoreExpansionForView(viewId);
      _devtools.closeDevToolsForView(viewInfo.view);
    }).pipe(
      Effect.onExit(() =>
        Effect.suspend(() =>
          Effect.fromResult(destroyView(viewInfo, _mainWindow)),
        ).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit)
              ? Effect.fromResult(
                  callViewNative("destroy", viewInfo, () => {
                    if (!viewInfo.view.webContents.isDestroyed())
                      viewInfo.view.webContents.close();
                  }),
                )
              : Effect.void,
          ),
        ),
      ),
      Effect.onExit(() =>
        Effect.sync(() => {
          if (_views.delete(viewId)) {
            _viewsByWebContentsId.delete(webContentsId);
            viewRemoved.emit({ viewId, appId: viewInfo.appId, webContentsId });
          }
        }),
      ),
    );
    if (viewInfo.viewType === "app" && layout.isTilingEnabled()) {
      const visibilityChanged = yield* Effect.fromResult(
        layout.syncTiledLayout(),
      );
      if (visibilityChanged) layout.reorderViewLayers();
    }
  });

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

  const focusView = Effect.fn(function* (viewId: number) {
    const viewInfo = yield* Effect.fromResult(findView(viewId, _views));
    yield* Effect.fromResult(
      callViewNative("focus", viewInfo, () =>
        viewInfo.view.webContents.focus(),
      ),
    );
  });

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
        Result.getOrThrow(destroyView(info, _mainWindow));
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

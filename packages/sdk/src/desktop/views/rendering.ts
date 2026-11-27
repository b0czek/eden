import * as path from "node:path";
import type {
  AppManifest,
  FilesystemLocation,
  WindowConfig,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Semaphore from "effect/Semaphore";
import { logBackgroundFailure } from "../../core/effects/failure-policy";
import { fromPromise } from "../../core/effects/io";
import { encodeLaunchContext } from "../../core/utils/app-launch-context";
import { createCachedFileReader } from "../../core/utils/cached-file-reader";
import { log } from "../../platform/logging/logger";
import type {
  Bounds,
  PlatformView,
  PlatformWebContents,
  WindowingPort,
} from "../../platform/ports/types";
import { callViewNative } from "./errors";
import type { FloatingWindows } from "./floating-windows";
import { createView as createPlatformView } from "./lifecycle";
import type { Tiling } from "./tiling";
import { type ViewInfo, type ViewMode, type ViewType, Z_LAYERS } from "./types";
export const createViewRendering = Effect.fn(function* (
  basePath: string,
  tilingController: Tiling,
  floatingWindows: FloatingWindows,
  windows: WindowingPort,
) {
  const forkInjection = yield* FiberSet.makeRuntime<never, void, never>();
  let _nextOverlayZIndex = Z_LAYERS.OVERLAY_MIN;
  let _nextViewId = 1;
  const _fileReader = yield* createCachedFileReader();
  const _basePath = basePath;
  const _tiling = tilingController;
  const _floatingWindows = floatingWindows;
  const _windows = windows;
  let _themeSource: () => string = () => "";
  // The theme stylesheet of each view that has Eden CSS. A page load
  // replaces the record when it injects Eden CSS again.
  const _themeSheets = new WeakMap<
    PlatformWebContents,
    { key: string | undefined; css: string }
  >();
  const _cssLocks = new WeakMap<PlatformWebContents, Semaphore.Semaphore>();

  function cssLock(webContents: PlatformWebContents) {
    let lock = _cssLocks.get(webContents);
    if (!lock) {
      lock = Semaphore.makeUnsafe(1);
      _cssLocks.set(webContents, lock);
    }
    return lock;
  }

  function isRemoteEntry(entry: string): boolean {
    return /^https?:\/\//i.test(entry);
  }

  function shouldInjectAppFrame(windowConfig?: WindowConfig): boolean {
    const appFrameMode = windowConfig?.injections?.appFrame;
    return appFrameMode !== false && appFrameMode !== "none";
  }

  function getCSSInjectionMode(
    windowConfig?: WindowConfig,
  ): "full" | "tokens" | "none" {
    const cssOption = windowConfig?.injections?.css;
    if (cssOption === undefined) {
      return "full";
    }
    return cssOption;
  }

  const injectEdenCSS = Effect.fn(function* (
    view: PlatformView,
    mode: "full" | "tokens",
  ) {
    if (view.webContents.isDestroyed()) {
      log.error("Cannot inject CSS - webContents destroyed");
      return false;
    }

    return yield* Effect.gen(function* () {
      const edenCssPath = path.join(_basePath, "edencss");
      const cssFileName = mode === "full" ? "eden.css" : "eden-tokens.css";
      const cssPath = path.join(edenCssPath, cssFileName);

      const css = yield* _fileReader.read(cssPath);
      const webContents = view.webContents;
      yield* cssLock(webContents).withPermit(
        Effect.gen(function* () {
          yield* fromPromise(() => webContents.insertCSS(css));
          // The theme goes after Eden CSS. A theme stylesheet inserted
          // earlier is gone with the previous page or is removed here.
          const previous = _themeSheets.get(webContents);
          _themeSheets.set(webContents, { key: undefined, css: "" });
          if (previous?.key) {
            const key = previous.key;
            yield* fromPromise(() => webContents.removeInsertedCSS(key)).pipe(
              Effect.ignore,
            );
          }
          yield* applyThemeCSS(webContents);
        }),
      );

      log.info(`Injected Eden CSS (${mode})`);
      return true;
    }).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          log.error("Failed to inject Eden CSS:", err);
          return false;
        }),
      ),
    );
  });

  /**
   * Swaps the theme stylesheet of a view that has Eden CSS for the current
   * one. The caller holds the view's CSS lock.
   */
  const applyThemeCSS = Effect.fn(function* (webContents: PlatformWebContents) {
    const sheet = _themeSheets.get(webContents);
    const css = _themeSource();
    if (!sheet || webContents.isDestroyed() || sheet.css === css) return;
    if (sheet.key) {
      const key = sheet.key;
      yield* fromPromise(() => webContents.removeInsertedCSS(key));
      sheet.key = undefined;
      sheet.css = "";
    }
    if (!css || webContents.isDestroyed()) return;
    const key = yield* fromPromise(() => webContents.insertCSS(css));
    sheet.key = key;
    sheet.css = css;
  });

  /** Reapplies the theme stylesheet to views that use Eden CSS. */
  function refreshThemeStylesheet(views: Iterable<ViewInfo>) {
    for (const { view, manifest } of views) {
      if (getCSSInjectionMode(manifest.window) === "none") continue;
      const webContents = view.webContents;
      if (!_themeSheets.has(webContents)) continue;
      forkInjection(
        cssLock(webContents)
          .withPermit(applyThemeCSS(webContents))
          .pipe(logBackgroundFailure("Theme stylesheet update failed:")),
      );
    }
  }

  /** Each view loads this stylesheet after Eden CSS. */
  function setThemeSource(source: () => string, views: Iterable<ViewInfo>) {
    _themeSource = source;
    refreshThemeStylesheet(views);
  }

  const injectAppFrame = Effect.fn(function* (
    view: PlatformView,
    appId: string,
    manifestName: string | Record<string, string>,
    viewMode: ViewMode,
    windowConfig?: WindowConfig,
    bounds?: Bounds,
  ) {
    if (view.webContents.isDestroyed()) {
      log.error("Cannot inject frame - webContents destroyed");
      return false;
    }

    return yield* Effect.gen(function* () {
      // Inject CSS first
      const frameCSSPath = path.join(_basePath, "app-frame/frame.css");
      const frameCSS = yield* _fileReader.read(frameCSSPath);
      yield* fromPromise(() => view.webContents.insertCSS(frameCSS));

      // Inject bundled JavaScript
      const frameScriptPath = path.join(
        _basePath,
        "app-frame/frame-injector.js",
      );
      const frameScript = yield* _fileReader.read(frameScriptPath);

      // Pre-populate window.edenFrame with config
      const configScript = `
        window.edenFrame = {
          _internal: {
            appId: "${appId}",
            appName: ${JSON.stringify(manifestName)},
            injected: false,
            config: ${JSON.stringify(windowConfig || {})},
            currentMode: "${viewMode}",
            bounds: ${JSON.stringify(
              bounds || { x: 0, y: 0, width: 0, height: 0 },
            )}
          }
        };
      `;

      // Execute config initialization followed by frame script
      yield* fromPromise(() =>
        view.webContents.executeJavaScript(configScript + frameScript),
      );

      log.info(`App frame injected (mode: ${viewMode})`);
      return true;
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          log.error("Failed to inject app frame:", error);
          return false;
        }),
      ),
    );
  });

  function calculateViewBounds(
    isOverlay: boolean,
    viewMode: ViewMode,
    appId: string,
    bounds: Bounds | undefined,
    windowConfig: WindowConfig | undefined,
    existingViews: Iterable<ViewInfo>,
  ) {
    if (isOverlay) {
      return calculateOverlayBounds(appId, bounds, windowConfig);
    } else if (viewMode === "floating") {
      return calculateFloatingAppBounds(appId, bounds, windowConfig);
    } else {
      return calculateTiledAppBounds(appId, bounds, existingViews);
    }
  }

  function calculateOverlayBounds(
    appId: string,
    bounds: Bounds | undefined,
    windowConfig?: WindowConfig,
  ) {
    const zIndex = _nextOverlayZIndex++;
    const viewBounds =
      bounds ||
      _floatingWindows.calculateInitialBounds(
        windowConfig,
        windowConfig?.scaling === "auto",
      );
    log.info(`Creating overlay view for ${appId} at Z=${zIndex}`);
    return { viewBounds, zIndex, tileIndex: undefined };
  }

  function calculateFloatingAppBounds(
    appId: string,
    bounds: Bounds | undefined,
    windowConfig?: WindowConfig,
  ) {
    const viewBounds =
      bounds ||
      _floatingWindows.calculateInitialBounds(
        windowConfig,
        windowConfig?.scaling !== "manual",
      );
    const zIndex = _floatingWindows.getNextZIndex();
    log.info(`Creating floating app view for ${appId}`);
    return { viewBounds, zIndex, tileIndex: undefined };
  }

  function calculateTiledAppBounds(
    appId: string,
    bounds: Bounds | undefined,
    existingViews: Iterable<ViewInfo>,
  ) {
    log.info(`Creating tiled app view for ${appId}`);

    if (_tiling.isEnabled()) {
      const tileIndex = _tiling.getNextTileIndex(existingViews);
      const viewBounds = bounds || {
        ..._tiling.getWorkspaceBounds(),
      };
      return { viewBounds, tileIndex, zIndex: undefined };
    }

    // Fallback if tiling disabled but mode is tiled (shouldn't happen with determineViewMode)
    const viewBounds = bounds || { x: 0, y: 0, width: 800, height: 600 };
    return { viewBounds, tileIndex: undefined, zIndex: undefined };
  }

  const createView = Effect.fn(function* (
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    existingViews: Iterable<ViewInfo>,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ) {
    // Extract manifest properties
    const windowConfig = manifest.window;
    const isOverlay = !!manifest.overlay;
    const viewType: ViewType = isOverlay ? "overlay" : "app";
    // Note: createView is only called when manifest.frontend exists
    // (Processes validates this before calling)
    const frontendEntry = manifest.frontend?.entry;
    if (!frontendEntry) {
      throw new Error(
        `Cannot create view for ${appId}: missing frontend entry`,
      );
    }

    // Determine view mode
    const viewMode: ViewMode = isOverlay
      ? "floating"
      : _tiling.determineViewMode(windowConfig);

    // Calculate bounds and Z-index based on view type and mode
    const { viewBounds, tileIndex, zIndex } = calculateViewBounds(
      isOverlay,
      viewMode,
      appId,
      bounds,
      windowConfig,
      existingViews,
    );

    // View identifiers and paths
    const viewId = _nextViewId++;
    const preloadScript = path.join(_basePath, "app-runtime/app-preload.js");

    const view = yield* Effect.fromResult(
      createPlatformView(
        {
          preloadScript,
          additionalArguments: encodeLaunchContext({
            appId,
            args: launchArgs ?? [],
            file: launchFile,
          }),
        },
        _windows,
        { appId, viewId },
      ),
    );

    return yield* Effect.gen(function* () {
      log.info(
        `Creating ${viewType} view for ${appId} with preload: ${preloadScript}`,
      );

      // Set bounds
      yield* Effect.fromResult(
        callViewNative("set-bounds", { id: viewId, appId }, () =>
          view.setBounds(viewBounds),
        ),
      );

      const remote = isRemoteEntry(frontendEntry);
      const target = remote
        ? frontendEntry
        : path.join(installPath, frontendEntry);
      if (remote)
        log.info(`Loading remote frontend for ${appId}: ${frontendEntry}`);
      yield* Effect.fromResult(
        callViewNative("create", { id: viewId, appId }, () => {
          if (remote) view.webContents.loadURL(target);
          else view.webContents.loadFile(target);
        }),
      );

      // Setup injections after view is loaded
      yield* Effect.fromResult(
        callViewNative("register", { id: viewId, appId }, () => {
          view.webContents.on("did-finish-load", () => {
            forkInjection(
              Effect.gen(function* () {
                const cssMode = getCSSInjectionMode(windowConfig);
                if (cssMode !== "none") yield* injectEdenCSS(view, cssMode);
                if (
                  shouldInjectAppFrame(windowConfig) &&
                  !view.webContents.isDestroyed()
                )
                  yield* injectAppFrame(
                    view,
                    appId,
                    manifest.name,
                    viewMode,
                    windowConfig,
                    view.getBounds(),
                  );
              }).pipe(logBackgroundFailure("View injection failed:")),
            );
          });
        }),
      );

      // Return view info
      return {
        id: viewId,
        view,
        appId,
        manifest,
        bounds: viewBounds,
        requestedVisible: true,
        visible: true,
        mode: viewMode,
        viewType,
        tileIndex,
        zIndex,
        launchArgs,
      } satisfies ViewInfo;
    }).pipe(
      Effect.onExit((exit) =>
        Exit.isFailure(exit)
          ? Effect.fromResult(
              callViewNative("destroy", { id: viewId, appId }, () => {
                if (!view.webContents.isDestroyed()) view.webContents.close();
              }),
            )
          : Effect.void,
      ),
    );
  }, Effect.uninterruptible);

  return {
    isRemoteEntry,
    shouldInjectAppFrame,
    getCSSInjectionMode,
    injectEdenCSS,
    injectAppFrame,
    createView,
    setThemeSource,
    refreshThemeStylesheet,
  };
});

export type ViewRendering = Effect.Success<
  ReturnType<typeof createViewRendering>
>;

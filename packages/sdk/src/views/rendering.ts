import * as path from "node:path";
import type {
  AppManifest,
  FilesystemLocation,
  WindowConfig,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FiberSet from "effect/FiberSet";
import { fromPromise } from "../effects/io";
import { log } from "../logging";
import type { Bounds, PlatformView, WindowingPort } from "../platform/ports";
import { encodeLaunchContext } from "../utils/app-launch-context";
import { createCachedFileReader } from "../utils/cached-file-reader";
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

  function embeddingHeadersFilter(
    details: { responseHeaders?: Record<string, string[]> },
    callback: (response: {
      responseHeaders?: Record<string, string[]>;
    }) => void,
  ): void {
    const responseHeaders = { ...details.responseHeaders };
    for (const key of Object.keys(responseHeaders)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey === "x-frame-options" ||
        lowerKey === "content-security-policy"
      ) {
        delete responseHeaders[key];
      }
    }
    callback({ responseHeaders });
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
      yield* fromPromise(() => view.webContents.insertCSS(css));

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

  function createView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    existingViews: Iterable<ViewInfo>,
    launchArgs?: string[],
    launchFile?: FilesystemLocation,
  ): ViewInfo {
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

    const view = createPlatformView(
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
    );

    try {
      log.info(
        `Creating ${viewType} view for ${appId} with preload: ${preloadScript}`,
      );

      // Set bounds
      callViewNative("set-bounds", { id: viewId, appId }, () =>
        view.setBounds(viewBounds),
      );

      // Strip embedding headers if enabled
      if (manifest.frontend?.allowEmbedding) {
        view.webContents.session.webRequest.onHeadersReceived(
          { urls: ["*://*/*"] },
          embeddingHeadersFilter,
        );
      }

      // Load the frontend HTML or remote URL
      if (isRemoteEntry(frontendEntry)) {
        log.info(`Loading remote frontend for ${appId}: ${frontendEntry}`);
        view.webContents.loadURL(frontendEntry);
      } else {
        const frontendPath = path.join(installPath, frontendEntry);
        view.webContents.loadFile(frontendPath);
      }

      // Setup injections after view is loaded
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
          }).pipe(
            Effect.catchCause((cause) =>
              Cause.hasInterruptsOnly(cause)
                ? Effect.failCause(cause)
                : Effect.sync(() =>
                    log.error("View injection failed:", Cause.squash(cause)),
                  ),
            ),
          ),
        );
      });

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
      };
    } catch (error) {
      try {
        if (!view.webContents.isDestroyed()) view.webContents.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Failed to create and release frontend for ${appId}`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  return {
    isRemoteEntry,
    shouldInjectAppFrame,
    getCSSInjectionMode,
    injectEdenCSS,
    injectAppFrame,
    createView,
  };
});

export type ViewRendering = Effect.Success<
  ReturnType<typeof createViewRendering>
>;

import * as path from "node:path";
import type { AppManifest, WindowConfig } from "@edenapp/types";
import type { Rectangle as Bounds, WebContentsView } from "electron";
import { log } from "../logging";
import { cachedFileReader } from "../utils/cachedFileReader";
import type { FloatingWindowController } from "./FloatingWindowController";
import type { TilingController } from "./TilingController";
import { type ViewInfo, type ViewMode, type ViewType, Z_LAYERS } from "./types";
import { createView } from "./viewLifecycle";
/**
 * ViewCreator
 *
 * Handles creation and injection of views.
 * Extracted from ViewManager for better separation of concerns.
 */
export class ViewCreator {
  private nextOverlayZIndex = Z_LAYERS.OVERLAY_MIN;
  private nextViewId = 1;

  constructor(
    private readonly basePath: string,
    private readonly tilingController: TilingController,
    private readonly floatingWindows: FloatingWindowController,
  ) {}

  /**
   * Check if a frontend entry points to a remote URL
   */
  isRemoteEntry(entry: string): boolean {
    return /^https?:\/\//i.test(entry);
  }

  /**
   * Determine whether the app frame should be injected
   */
  shouldInjectAppFrame(windowConfig?: WindowConfig): boolean {
    const appFrameMode = windowConfig?.injections?.appFrame;
    return appFrameMode !== false && appFrameMode !== "none";
  }

  /**
   * Get the CSS injection mode from window config
   * Returns "full" by default if not specified
   */
  getCSSInjectionMode(windowConfig?: WindowConfig): "full" | "tokens" | "none" {
    const cssOption = windowConfig?.injections?.css;
    if (cssOption === undefined) {
      return "full";
    }
    return cssOption;
  }

  /**
   * Callback that strips X-Frame-Options and CSP headers from responses.
   */
  private static embeddingHeadersFilter(
    details: Electron.OnHeadersReceivedListenerDetails,
    callback: (response: Electron.HeadersReceivedResponse) => void,
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

  /**
   * Inject Eden CSS into the view
   * Makes design tokens and utilities available to all apps
   * @param view - The WebContentsView to inject CSS into
   * @param mode - "full" for complete CSS or "tokens" for only CSS custom properties
   */
  async injectEdenCSS(
    view: WebContentsView,
    mode: "full" | "tokens",
  ): Promise<boolean> {
    if (view.webContents.isDestroyed()) {
      log.error("Cannot inject CSS - webContents destroyed");
      return false;
    }

    try {
      const edenCssPath = path.join(this.basePath, "edencss");
      const cssFileName = mode === "full" ? "eden.css" : "eden-tokens.css";
      const cssPath = path.join(edenCssPath, cssFileName);

      const css = await cachedFileReader.readAsync(cssPath, "utf-8");
      await view.webContents.insertCSS(css);

      log.info(`Injected Eden CSS (${mode})`);
      return true;
    } catch (err) {
      log.error("Failed to inject Eden CSS:", err);
      return false;
    }
  }

  /**
   * Inject app frame script into the view
   * Adds a title bar with close button to each app
   */
  async injectAppFrame(
    view: WebContentsView,
    appId: string,
    manifestName: string | Record<string, string>,
    viewMode: ViewMode,
    windowConfig?: WindowConfig,
    bounds?: Bounds,
  ): Promise<boolean> {
    if (view.webContents.isDestroyed()) {
      log.error("Cannot inject frame - webContents destroyed");
      return false;
    }

    try {
      // Inject CSS first
      const frameCSSPath = path.join(this.basePath, "app-frame/frame.css");
      const frameCSS = await cachedFileReader.readAsync(frameCSSPath, "utf-8");
      await view.webContents.insertCSS(frameCSS);

      // Inject bundled JavaScript
      const frameScriptPath = path.join(
        this.basePath,
        "app-frame/frame-injector.js",
      );
      const frameScript = await cachedFileReader.readAsync(
        frameScriptPath,
        "utf-8",
      );

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
      await view.webContents.executeJavaScript(configScript + frameScript);

      log.info(`App frame injected (mode: ${viewMode})`);
      return true;
    } catch (error) {
      log.error("Failed to inject app frame:", error);
      return false;
    }
  }

  /**
   * Calculate view bounds, tile index, and Z-index based on view type and mode
   */
  private calculateViewBounds(
    isOverlay: boolean,
    viewMode: ViewMode,
    appId: string,
    bounds: Bounds | undefined,
    windowConfig: WindowConfig | undefined,
    existingViews: Iterable<ViewInfo>,
  ) {
    if (isOverlay) {
      return this.calculateOverlayBounds(appId, bounds, windowConfig);
    } else if (viewMode === "floating") {
      return this.calculateFloatingAppBounds(appId, bounds, windowConfig);
    } else {
      return this.calculateTiledAppBounds(appId, bounds, existingViews);
    }
  }

  /**
   * Calculate bounds and Z-index for overlay views
   */
  private calculateOverlayBounds(
    appId: string,
    bounds: Bounds | undefined,
    windowConfig?: WindowConfig,
  ) {
    const zIndex = this.nextOverlayZIndex++;
    const viewBounds =
      bounds || this.floatingWindows.calculateInitialBounds(windowConfig);
    log.info(`Creating overlay view for ${appId} at Z=${zIndex}`);
    return { viewBounds, zIndex, tileIndex: undefined };
  }

  /**
   * Calculate bounds and Z-index for floating app views
   */
  private calculateFloatingAppBounds(
    appId: string,
    bounds: Bounds | undefined,
    windowConfig?: WindowConfig,
  ) {
    const viewBounds =
      bounds || this.floatingWindows.calculateInitialBounds(windowConfig);
    const zIndex = this.floatingWindows.getNextZIndex();
    log.info(`Creating floating app view for ${appId}`);
    return { viewBounds, zIndex, tileIndex: undefined };
  }

  /**
   * Calculate bounds and tile index for tiled app views
   */
  private calculateTiledAppBounds(
    appId: string,
    bounds: Bounds | undefined,
    existingViews: Iterable<ViewInfo>,
  ) {
    log.info(`Creating tiled app view for ${appId}`);

    if (this.tilingController.isEnabled()) {
      const tileIndex = this.tilingController.getNextTileIndex(existingViews);
      const visibleCount =
        this.tilingController.getVisibleTiledCount(existingViews) + 1;
      const viewBounds = this.tilingController.calculateTileBounds(
        tileIndex,
        visibleCount,
      );
      return { viewBounds, tileIndex, zIndex: undefined };
    }

    // Fallback if tiling disabled but mode is tiled (shouldn't happen with determineViewMode)
    const viewBounds = bounds || { x: 0, y: 0, width: 800, height: 600 };
    return { viewBounds, tileIndex: undefined, zIndex: undefined };
  }

  /**
   * Create a view for an app (regular or overlay)
   * ViewType is determined by manifest.overlay flag
   */
  public createView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    existingViews: Iterable<ViewInfo>,
    launchArgs?: string[],
  ): ViewInfo {
    // Extract manifest properties
    const windowConfig = manifest.window;
    const isOverlay = !!manifest.overlay;
    const viewType: ViewType = isOverlay ? "overlay" : "app";
    // Note: createView is only called when manifest.frontend exists
    // (ProcessManager validates this before calling)
    const frontendEntry = manifest.frontend!.entry;

    // Determine view mode
    const viewMode: ViewMode = isOverlay
      ? "floating"
      : this.tilingController.determineViewMode(windowConfig?.mode);

    // Calculate bounds and Z-index based on view type and mode
    const { viewBounds, tileIndex, zIndex } = this.calculateViewBounds(
      isOverlay,
      viewMode,
      appId,
      bounds,
      windowConfig,
      existingViews,
    );

    // View identifiers and paths
    const viewId = this.nextViewId++;
    const preloadScript = path.join(
      this.basePath,
      "app-runtime/app-preload.js",
    );

    const view = createView({
      preloadScript,
      additionalArguments: [
        `--app-id=${appId}`,
        `--launch-args=${JSON.stringify(launchArgs || [])}`,
      ],
    });

    log.info(
      `Creating ${viewType} view for ${appId} with preload: ${preloadScript}`,
    );

    // Set bounds
    view.setBounds(viewBounds);

    // Strip embedding headers if enabled
    if (manifest.frontend?.allowEmbedding) {
      view.webContents.session.webRequest.onHeadersReceived(
        { urls: ["*://*/*"] },
        ViewCreator.embeddingHeadersFilter,
      );
    }

    // Load the frontend HTML or remote URL
    if (this.isRemoteEntry(frontendEntry)) {
      log.info(`Loading remote frontend for ${appId}: ${frontendEntry}`);
      view.webContents.loadURL(frontendEntry);
    } else {
      const frontendPath = path.join(installPath, frontendEntry);
      view.webContents.loadFile(frontendPath);
    }

    // Setup injections after view is loaded
    view.webContents.on("did-finish-load", () => {
      // Inject the Eden CSS first (based on mode)
      const cssMode = this.getCSSInjectionMode(windowConfig);
      if (cssMode !== "none") {
        this.injectEdenCSS(view, cssMode).catch((err) => {
          log.error(`Failed to inject Eden CSS for ${appId}:`, err);
        });
      }

      if (viewType === "app" && this.shouldInjectAppFrame(windowConfig)) {
        this.injectAppFrame(
          view,
          appId,
          manifest.name,
          viewMode,
          windowConfig,
          viewBounds,
        ).catch((err) => {
          log.error(`Failed to inject app frame for ${appId}:`, err);
        });
      }
    });

    // Return view info
    return {
      id: viewId,
      view,
      appId,
      manifest,
      bounds: viewBounds,
      visible: true,
      mode: viewMode,
      viewType,
      tileIndex,
      zIndex,
      launchArgs,
    };
  }
}

import {
  BrowserWindow,
  Rectangle as Bounds,
  WebContentsView,
} from "electron";
import { EventEmitter } from "events";
import * as path from "path";
import { cachedFileReader } from "../utils/cachedFileReader";
import { AppManifest, TilingConfig, WindowConfig, EdenConfig, WindowSize } from "@edenapp/types";
import { LayoutCalculator } from "./LayoutCalculator";
import { FloatingWindowController } from "./FloatingWindowController";
import { DevToolsManager } from "./DevToolsManager";
import { ViewInfo, ViewMode, ViewType, Z_LAYERS, CreateViewOptions } from "./types";


import { injectable, inject } from "tsyringe";
import { CommandRegistry, IPCBridge } from "../ipc";
import { ViewHandler } from "./ViewHandler";

@injectable()
export class ViewManager extends EventEmitter {
  private views: Map<number, ViewInfo> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private nextViewId = 1;
  private nextOverlayZIndex = Z_LAYERS.OVERLAY_MIN;
  private tilingConfig: TilingConfig = {
    mode: "none",
    gap: 0,
    padding: 0,
  };
  private floatingWindows: FloatingWindowController;
  private devToolsManager: DevToolsManager;
  private workspaceBounds: Bounds = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  };

  private windowSize: WindowSize = {
    width: 800,
    height: 600,
  };

  private viewHandler: ViewHandler;
  private ipcBridge: IPCBridge;

  constructor(
    @inject("CommandRegistry") commandRegistry: CommandRegistry,
    @inject("IPCBridge") ipcBridge: IPCBridge,
    @inject("EdenConfig") config: EdenConfig
  ) {
    super();
    this.ipcBridge = ipcBridge;
    this.tilingConfig = config.tiling || { mode: "none", gap: 0, padding: 0 };
    this.floatingWindows = new FloatingWindowController(
      () => this.workspaceBounds,
      () => this.views.values()
    );
    this.devToolsManager = new DevToolsManager();

    // Create and register handler
    this.viewHandler = new ViewHandler(this, ipcBridge);
    commandRegistry.registerManager(this.viewHandler);
  }



  /**
   * Set the main window that will host the views
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Set workspace bounds (the area where views can be placed)
   */
  setWorkspaceBounds(bounds: Bounds): void {
    this.workspaceBounds = bounds;
    // Recalculate all tile bounds if using tiling
    if (this.tilingConfig.mode !== "none") {
      this.recalculateTiledViews();
    }
  }

  setWindowSize(windowSize: WindowSize): void {
    this.windowSize = windowSize;
  }

  getWindowSize(): WindowSize {
    return this.windowSize;
  }

  /**
   * Calculate bounds for a tile based on tiling configuration
   */
  private calculateTileBounds(tileIndex: number): Bounds {
    // Count visible tiled views for dynamic layout
    const visibleTiledViews = Array.from(this.views.values()).filter(
      (v) => v.visible && v.mode === "tiled"
    );

    // Use the generic LayoutCalculator
    return LayoutCalculator.calculateTileBounds({
      workspace: this.workspaceBounds,
      tileIndex,
      visibleCount: visibleTiledViews.length,
      config: this.tilingConfig,
    });
  }

  /**
   * Recalculate bounds for all tiled views
   */
  private recalculateTiledViews(): void {
    if (this.tilingConfig.mode === "none") return;

    const visibleViews = Array.from(this.views.entries())
      .filter(([_, info]) => info.visible && info.mode === "tiled")
      .sort((a, b) => (a[1].tileIndex || 0) - (b[1].tileIndex || 0));

    visibleViews.forEach(([viewId, info], index) => {
      const bounds = this.calculateTileBounds(index);
      info.tileIndex = index;
      info.bounds = bounds;
      info.view.setBounds(bounds);
    });
  }

  /**
   * Get the next available tile index
   */
  private getNextTileIndex(): number {
    const indices = Array.from(this.views.values())
      .filter(
        (v) => v.visible && v.mode === "tiled" && v.tileIndex !== undefined
      )
      .map((v) => v.tileIndex!);

    if (indices.length === 0) return 0;
    return Math.max(...indices) + 1;
  }

  /**
   * Determine view mode based on manifest and tiling configuration
   */
  private determineViewMode(manifest: AppManifest): ViewMode {
    const windowConfig = manifest.window;

    // If no window config, default to tiled if tiling is enabled, else floating
    if (!windowConfig) {
      return this.tilingConfig.mode !== "none" ? "tiled" : "floating";
    }

    // Check what the app supports
    switch (windowConfig.mode) {
      case "floating":
        return "floating";
      case "tiled":
        return "tiled";
      case "both":
        // If app supports both, prefer tiled if tiling is enabled, else floating
        return this.tilingConfig.mode !== "none" ? "tiled" : "floating";
      default:
        return this.tilingConfig.mode !== "none" ? "tiled" : "floating";
    }
  }

  /**
   * Determine whether a specific runtime helper should be injected
   */
  /**
   * Determine if a frontend entry points to a remote URL
   */
  private isRemoteEntry(entry: string): boolean {
    return /^https?:\/\//i.test(entry);
  }

  private shouldInjectAppFrame(windowConfig?: WindowConfig): boolean {
    return windowConfig?.injections?.appFrame !== false;
  }

  /**
   * Get the CSS injection mode from window config
   * Returns "full" by default if not specified
   */
  private getCSSInjectionMode(windowConfig?: WindowConfig): "full" | "tokens" | "none" {
    const cssOption = windowConfig?.injections?.css;
    // Default to "full" if not specified
    if (cssOption === undefined) {
      return "full";
    }
    return cssOption;
  }

  /**
   * Inject app API into the view's webContents
   * Sends the channel info so the universal preload can set up the API
   */
  private injectAppAPI(view: WebContentsView, appId: string): void {
    const channel = `app-${appId}`;
    const requestChannel = `app-${appId}-request`;

    view.webContents.send("app-init-api", {
      appId,
      channel,
      requestChannel,
    });

    console.log(`Sent app API init for ${appId}`);
  }

  /**
   * Inject Eden Design System CSS into the view
   * Makes design tokens and utilities available to all apps
   * @param view - The WebContentsView to inject CSS into
   * @param mode - "full" for complete CSS or "tokens" for only CSS custom properties
   */
  private async injectDesignSystemCSS(
    view: WebContentsView,
    mode: "full" | "tokens"
  ): Promise<void> {
    try {
      const designSystemPath = path.join(__dirname, "../../design-system");
      // Select the appropriate CSS file based on mode
      const cssFileName = mode === "full" ? "eden.css" : "eden-tokens.css";
      const cssPath = path.join(designSystemPath, cssFileName);

      const css = await cachedFileReader.readAsync(cssPath, "utf-8");
      await view.webContents.insertCSS(css);

      console.log(`Successfully injected Eden Design System CSS (${mode}) into view`);
    } catch (err) {
      console.error("Failed to inject design system CSS:", err);
      // Don't throw - app should still work without design system
    }
  }

  /**
   * Inject app frame script into the view
   * This adds a title bar with close button to each app
   */
  private async injectAppFrame(
    view: WebContentsView,
    viewMode: ViewMode,
    windowConfig?: WindowConfig,
    bounds?: Bounds
  ): Promise<void> {
    try {
      // Inject CSS first
      const frameCSSPath = path.join(
        __dirname,
        "../../app-frame/frame.css"
      );
      const frameCSS = await cachedFileReader.readAsync(frameCSSPath, "utf-8");
      await view.webContents.insertCSS(frameCSS);

      // Inject bundled JavaScript
      const frameScriptPath = path.join(
        __dirname,
        "../../app-frame/frame-injector.js"
      );
      const frameScript = await cachedFileReader.readAsync(frameScriptPath, "utf-8");

      // Inject the frame script with window config and initial state
      await view.webContents.executeJavaScript(`
                // Initialize edenFrame structure before loading frame script
                window.edenFrame = {
                  setTitle: (title) => {}, // Will be overwritten by frame-injector
                  _internal: {
                    injected: false,
                    config: ${JSON.stringify(windowConfig || {})},
                    currentMode: "${viewMode}",
                    bounds: ${JSON.stringify(bounds || { x: 0, y: 0, width: 0, height: 0 })}
                  }
                };
                ${frameScript}
            `);
      console.log(
        `App frame injected successfully (mode: ${viewMode}, bounds:`,
        bounds,
        `)`
      );
    } catch (error) {
      console.error("Failed to inject app frame:", error);
    }
  }

  /**
   * Create a view (internal method - use createAppView or createOverlayView instead)
   */
  private createView(options: CreateViewOptions): number {
    const {
      appId,
      manifest,
      installPath,
      preloadScript,
      viewType,
      viewMode,
      viewBounds,
      tileIndex,
      zIndex,
    } = options;

    if (!this.mainWindow) {
      throw new Error("Main window not set. Call setMainWindow first.");
    }

    console.log(
      `Creating ${viewType} view for ${appId} with preload: ${preloadScript}`
    );

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: preloadScript,
        transparent: true,
        backgroundThrottling: false,
        // Enable overlay scrollbars
        scrollBounce: false,
      },
    });

    const viewId = this.nextViewId++;

    const windowConfig = manifest.window;

    // Register DevTools shortcut on this view
    this.devToolsManager.registerShortcut(view);

    // Set bounds
    view.setBounds(viewBounds);

    // Load the frontend HTML or remote URL
    const frontendEntry = manifest.frontend.entry;
    if (this.isRemoteEntry(frontendEntry)) {
      console.log(`Loading remote frontend for ${appId}: ${frontendEntry}`);
      view.webContents.loadURL(frontendEntry);
    } else {
      const frontendPath = path.join(installPath, frontendEntry);
      view.webContents.loadFile(frontendPath);
    }

    // Set up view event handlers
    view.webContents.on("did-finish-load", () => {
      // Inject the Eden Design System CSS first (based on mode)
      const cssMode = this.getCSSInjectionMode(windowConfig);
      if (cssMode !== "none") {
        this.injectDesignSystemCSS(view, cssMode).catch((err) => {
          console.error(
            `Failed to inject design system CSS for ${appId}:`,
            err
          );
        });
      }

      // Inject the app frame script (only for app views, not overlays)
      if (viewType === "app" && this.shouldInjectAppFrame(windowConfig)) {
        this.injectAppFrame(view, viewMode, windowConfig, viewBounds).catch(
          (err) => {
            console.error(`Failed to inject app frame for ${appId}:`, err);
          }
        );
      }

      // Inject the app API after page load (always enabled)
      this.injectAppAPI(view, appId);

      // Emit to IPC subscribers (webcontents)
      this.ipcBridge.eventSubscribers.notify("view-loaded", {
        viewId,
        appId,
        overlay: viewType === "overlay"
      });

      this.emit("view-loaded", { viewId, appId, overlay: viewType === "overlay" });
    });

    view.webContents.on(
      "did-fail-load",
      (_event: any, errorCode: any, errorDescription: any) => {
        console.error(`View load failed for ${appId}:`, errorDescription);
        const failData = {
          viewId,
          appId,
          errorCode,
          errorDescription,
        };
        // Emit to IPC subscribers (webcontents)
        this.ipcBridge.eventSubscribers.notify("view-load-failed", failData);
        this.emit("view-load-failed", failData);
      }
    );

    // Store view info
    this.views.set(viewId, {
      view,
      appId,
      manifest,
      bounds: viewBounds,
      visible: true,
      mode: viewMode,
      viewType,
      tileIndex,
      zIndex,
    });

    // Recalculate all tiles if using tiling and this is a tiled view
    if (viewMode === "tiled" && this.tilingConfig.mode !== "none") {
      this.recalculateTiledViews();
    }

    // Add to main window's contentView and maintain proper layering
    this.reorderViewLayers();

    return viewId;
  }

  /**
   * Create a view for a regular app
   * Uses sandboxed app-preload that provides limited, safe API
   */
  public createAppView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds
  ): number {
    const preloadScript = path.join(
      __dirname,
      "../../app-frame/app-preload.js"
    );

    const windowConfig = manifest.window;

    // Determine view mode based on manifest
    const viewMode = this.determineViewMode(manifest);

    // Calculate bounds based on view mode
    let viewBounds = bounds;
    let tileIndex: number | undefined = undefined;
    let zIndex: number | undefined = undefined;

    if (viewMode === "floating") {
      // Floating window - calculate bounds from manifest or use defaults
      viewBounds = this.floatingWindows.calculateInitialBounds(windowConfig);
      zIndex = this.floatingWindows.getNextZIndex();
      console.log(
        `Creating floating app view for ${appId} with bounds:`,
        viewBounds
      );
    } else if (viewMode === "tiled") {
      // Tiled window - calculate tile position
      if (this.tilingConfig.mode !== "none") {
        tileIndex = this.getNextTileIndex();
        viewBounds = this.calculateTileBounds(tileIndex);
      }
      console.log(`Creating tiled app view for ${appId} with bounds:`, viewBounds);
    }

    return this.createView({
      appId,
      manifest,
      installPath,
      preloadScript,
      viewType: "app",
      viewMode,
      viewBounds,
      tileIndex,
      zIndex,
    });
  }

  /**
   * Create an overlay view (e.g., shell overlay)
   * Uses eve-preload that provides full edenAPI access
   * Overlays are always floating and use their own z-index counter
   */
  public createOverlayView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds
  ): number {
    const preloadScript = path.join(
      __dirname,
      "../../eveshell/eve-preload.js"
    );

    // Overlays are always floating mode
    const viewMode: ViewMode = "floating";

    // Overlays use their own z-index counter and provided bounds
    const zIndex = this.nextOverlayZIndex++;
    const viewBounds = bounds;

    console.log(`Creating overlay view for ${appId} at Z=${zIndex}`);

    return this.createView({
      appId,
      manifest,
      installPath,
      preloadScript,
      viewType: "overlay",
      viewMode,
      viewBounds,
      tileIndex: undefined,
      zIndex,
    });
  }

  /**
   * Remove a view
   */
  removeView(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      return false;
    }

    try {
      // Close DevTools if open
      this.devToolsManager.closeDevToolsForView(viewInfo.view);

      // Check if view is already destroyed
      if (!viewInfo.view.webContents.isDestroyed()) {
        // Only try to remove if mainWindow still exists and view is not destroyed
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.contentView.removeChildView(viewInfo.view);
        }
      }


      // Clean up all event subscriptions for this view
      this.ipcBridge.eventSubscribers.removeViewSubscriptions(viewId);

      // Remove from tracking map
      this.views.delete(viewId);

      // Recalculate tiles if using tiling and this was an app view
      if (viewInfo.viewType === "app" && this.tilingConfig.mode !== "none") {
        this.recalculateTiledViews();
      }

      return true;
    } catch (error) {
      console.error(`Failed to remove view ${viewId}:`, error);
      // Still remove from tracking even if removal failed
      this.views.delete(viewId);
      return false;
    }
  }

  /**
   * Update view bounds
   */
  setViewBounds(viewId: number, bounds: Bounds): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      return false;
    }

    // If this is an overlay view, set bounds directly without constraints
    if (viewInfo.viewType === "overlay") {
      try {
        viewInfo.view.setBounds(bounds);
        viewInfo.bounds = bounds;
        return true;
      } catch (error) {
        console.error(`Failed to set bounds for overlay view ${viewId}:`, error);
        return false;
      }
    }

    // If this is a tiled view, ignore individual bounds updates
    // Bounds are managed by the tiling system
    if (viewInfo.mode === "tiled") {
      console.log(`Ignoring individual bounds update for tiled view ${viewId}`);
      return true;
    }

    // For floating views, allow bounds updates
    if (!viewInfo.visible) {
      // Still store the bounds for when view becomes visible again
      viewInfo.bounds = bounds;
      return true;
    }

    try {
      // Apply min/max constraints if specified in window config
      const windowConfig = viewInfo.manifest.window;
      const finalBounds = this.floatingWindows.applyWindowConstraints(
        bounds,
        windowConfig
      );

      viewInfo.view.setBounds(finalBounds);
      viewInfo.bounds = finalBounds;
      return true;
    } catch (error) {
      console.error(`Failed to set bounds for view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Get view by ID
   */
  getView(viewId: number): WebContentsView | undefined {
    return this.views.get(viewId)?.view;
  }

  /**
   * Get view info
   */
  getViewInfo(viewId: number): ViewInfo | undefined {
    return this.views.get(viewId);
  }

  /**
   * Find views by app ID
   */
  getViewsByAppId(appId: string): number[] {
    const viewIds: number[] = [];
    for (const [viewId, info] of this.views.entries()) {
      if (info.appId === appId) {
        viewIds.push(viewId);
      }
    }
    return viewIds;
  }

  /**
   * Get app ID from a webContents ID
   * Useful for identifying which app sent an IPC message
   */
  getAppIdByWebContentsId(webContentsId: number): string | undefined {
    for (const [, info] of this.views.entries()) {
      if (info.view.webContents.id === webContentsId) {
        return info.appId;
      }
    }
    return undefined;
  }

  /**
   * Get view ID from a webContents ID
   */
  getViewIdByWebContentsId(webContentsId: number): number | undefined {
    for (const [viewId, info] of this.views.entries()) {
      if (info.view.webContents.id === webContentsId) {
        return viewId;
      }
    }
    return undefined;
  }

  /**
   * Get all views (as entries for iteration)
   */
  getAllViews(): [number, ViewInfo][] {
    return Array.from(this.views.entries());
  }

  /**
   * Show a view (bring to front)
   */
  showView(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      // Mark as visible first
      viewInfo.visible = true;

      if (viewInfo.mode === "tiled") {
        // Tiled view - recalculate all tiles
        this.recalculateTiledViews();
        // Ensure proper layering (floating windows stay on top)
        this.reorderViewLayers();
      } else {
        // Floating view - update z-index to be on top of other floating windows
        viewInfo.zIndex = this.floatingWindows.getNextZIndex();
        // Reorder all views to maintain proper layering
        this.reorderViewLayers();
      }

      return true;
    } catch (error) {
      console.error(`Failed to show view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Hide a view by setting its bounds to zero
   */
  hideView(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      // Mark as hidden
      viewInfo.visible = false;

      // Always hide by setting bounds to zero
      viewInfo.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

      // If this is a tiled view, recalculate tiles for remaining visible views
      if (viewInfo.mode === "tiled") {
        this.recalculateTiledViews();
      }

      return true;
    } catch (error) {
      console.error(`Failed to hide view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Reorder all views to maintain proper layering:
   * - Tiled app views on bottom
   * - Floating app views in middle, ordered by zIndex
   * - Overlay views on top, ordered by zIndex
   */
  private reorderViewLayers(): void {
    if (!this.mainWindow) return;

    try {
      // Get app views sorted by layer (tiled and floating)
      const appViews = Array.from(this.views.values()).filter(
        (v) => v.viewType === "app"
      );

      const tiledViews = appViews
        .filter((v) => v.mode === "tiled")
        .sort((a, b) => (a.tileIndex || 0) - (b.tileIndex || 0));

      const floatingAppViews = this.floatingWindows.getOrderedFloatingViews();

      // Get overlay views sorted by zIndex
      const overlayViews = Array.from(this.views.values())
        .filter((v) => v.viewType === "overlay")
        .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

      // Remove all views
      for (const info of this.views.values()) {
        this.mainWindow.contentView.removeChildView(info.view);
      }

      // Add back in order: tiled (bottom), floating apps (middle), overlays (top)
      for (const info of tiledViews) {
        this.mainWindow.contentView.addChildView(info.view);
        info.view.setBounds(info.bounds);
      }

      for (const info of floatingAppViews) {
        this.mainWindow.contentView.addChildView(info.view);
        info.view.setBounds(info.bounds);
      }

      for (const info of overlayViews) {
        this.mainWindow.contentView.addChildView(info.view);
        info.view.setBounds(info.bounds);
      }
    } catch (error) {
      console.error("Failed to reorder view layers:", error);
    }
  }

  /**
   * Bring a view to the front (highest z-index)
   */
  bringToFront(viewId: number): boolean {
    return this.showView(viewId);
  }

  /**
   * Send a view to the back (lowest z-index within its layer)
   */
  sendToBack(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      if (viewInfo.mode === "floating") {
        const newZIndex = this.floatingWindows.getBackmostZIndex();
        if (newZIndex !== undefined) {
          viewInfo.zIndex = newZIndex;
        }
      }
      // For tiled views, no need to change anything as they're always below floating

      // Reorder all views to maintain proper layering
      this.reorderViewLayers();

      return true;
    } catch (error) {
      console.error(`Failed to send view ${viewId} to back:`, error);
      return false;
    }
  }

  /**
   * Set the z-order of a view relative to other views in the same layer
   * @param viewId - The view to reorder
   * @param position - Position in z-order within its layer (0 = back, higher = more front)
   */
  setZOrder(viewId: number, position: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      if (viewInfo.mode === "floating") {
        const newZIndex = this.floatingWindows.getZIndexForPosition(position);
        if (newZIndex !== undefined) {
          viewInfo.zIndex = newZIndex;
        }
      }
      // For tiled views, z-order within tiled layer is managed by tileIndex

      // Reorder all views to maintain proper layering
      this.reorderViewLayers();

      return true;
    } catch (error) {
      console.error(`Failed to set z-order for view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Send message to view's webContents
   */
  sendToView(viewId: number, channel: string, ...args: any[]): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      return false;
    }

    try {
      viewInfo.view.webContents.send(channel, ...args);
      return true;
    } catch (error) {
      console.error(`Failed to send message to view ${viewId}:`, error);
      return false;
    }
  }

  /**
   * Get all active view IDs
   */
  getActiveViews(): number[] {
    return Array.from(this.views.keys());
  }

  /**
   * Toggle or set view mode between tiled and floating
   * @param viewId - The view to change
   * @param targetMode - The desired mode, or undefined to toggle
   * @returns true if successful, false otherwise
   */
  setViewMode(viewId: number, targetMode?: ViewMode): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    // Check if app supports the target mode
    const manifest = viewInfo.manifest;
    const windowConfig = manifest.window;

    // Determine target mode
    let newMode: ViewMode;
    if (targetMode) {
      newMode = targetMode;
    } else {
      // Toggle mode
      newMode = viewInfo.mode === "floating" ? "tiled" : "floating";
    }

    // Check if the app supports this mode
    if (windowConfig?.mode) {
      if (windowConfig.mode === "floating" && newMode === "tiled") {
        console.log(`App ${viewInfo.appId} only supports floating mode`);
        return false;
      }
      if (windowConfig.mode === "tiled" && newMode === "floating") {
        console.log(`App ${viewInfo.appId} only supports tiled mode`);
        return false;
      }
    }

    // If already in target mode, do nothing
    if (viewInfo.mode === newMode) {
      console.log(`View ${viewId} is already in ${newMode} mode`);
      return true;
    }

    console.log(
      `Switching view ${viewId} from ${viewInfo.mode} to ${newMode} mode`
    );

    try {
      if (newMode === "floating") {
        // Switching from tiled to floating
        // Remove from tiling system
        viewInfo.tileIndex = undefined;

        // Calculate floating bounds (centered or with cascade)
        const floatingBounds =
          this.floatingWindows.calculateInitialBounds(windowConfig);
        viewInfo.bounds = floatingBounds;
        viewInfo.zIndex = this.floatingWindows.getNextZIndex();
        viewInfo.mode = "floating";

        // Update view bounds
        viewInfo.view.setBounds(floatingBounds);

        // Recalculate remaining tiled views
        if (this.tilingConfig.mode !== "none") {
          this.recalculateTiledViews();
        }

        // Reorder all views to maintain proper layering (floating on top)
        this.reorderViewLayers();

        // Notify the view about mode change
        viewInfo.view.webContents
          .executeJavaScript(
            `
                    window.postMessage({ type: 'view-mode-changed', mode: 'floating', bounds: ${JSON.stringify(
              floatingBounds
            )} }, '*');
                `
          )
          .catch((err) =>
            console.error("Failed to notify view of mode change:", err)
          );
      } else {
        // Switching from floating to tiled
        // Remove floating properties
        viewInfo.zIndex = undefined;

        // Add to tiling system
        if (this.tilingConfig.mode !== "none") {
          viewInfo.tileIndex = this.getNextTileIndex();
          const tileBounds = this.calculateTileBounds(viewInfo.tileIndex);
          viewInfo.bounds = tileBounds;
          viewInfo.mode = "tiled";

          // Update view bounds
          viewInfo.view.setBounds(tileBounds);

          // Recalculate all tiles
          this.recalculateTiledViews();

          // Reorder all views to maintain proper layering (tiled below floating)
          this.reorderViewLayers();

          // Notify the view about mode change
          viewInfo.view.webContents
            .executeJavaScript(
              `
                        window.postMessage({ type: 'view-mode-changed', mode: 'tiled', bounds: ${JSON.stringify(
                tileBounds
              )} }, '*');
                    `
            )
            .catch((err) =>
              console.error("Failed to notify view of mode change:", err)
            );
        } else {
          // No tiling enabled, use full workspace
          const bounds = { ...this.workspaceBounds };
          viewInfo.bounds = bounds;
          viewInfo.mode = "tiled";

          viewInfo.view.setBounds(bounds);

          // Reorder all views to maintain proper layering (tiled below floating)
          this.reorderViewLayers();

          // Notify the view about mode change
          viewInfo.view.webContents
            .executeJavaScript(
              `
                        window.postMessage({ type: 'view-mode-changed', mode: 'tiled', bounds: ${JSON.stringify(
                bounds
              )} }, '*');
                    `
            )
            .catch((err) =>
              console.error("Failed to notify view of mode change:", err)
            );
        }
      }

      console.log(`View ${viewId} successfully switched to ${newMode} mode`);
      return true;
    } catch (error) {
      console.error(
        `Failed to switch view ${viewId} to ${newMode} mode:`,
        error
      );
      return false;
    }
  }

  /**
   * Remove all views
   */
  removeAllViews(): void {
    for (const viewId of this.views.keys()) {
      this.removeView(viewId);
    }
  }

}

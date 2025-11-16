import {
  BrowserWindow,
  Rectangle as Bounds,
  WebContentsView,
  globalShortcut,
} from "electron";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs/promises";
import { AppManifest, TilingConfig, WindowConfig } from "../../types";
import { LayoutCalculator } from "./LayoutCalculator";

type ViewMode = "floating" | "tiled";

interface ViewInfo {
  view: WebContentsView;
  appId: string;
  manifest: AppManifest;
  bounds: Bounds;
  visible: boolean;
  mode: ViewMode; // Whether this view is floating or tiled
  tileIndex?: number; // Index in the tiling grid (only for tiled views)
  zIndex?: number; // Z-order for floating windows
}

/**
 * ViewManager
 *
 * Manages WebContentsView instances for app frontends.
 * Each app's frontend runs in its own isolated view.
 */
export class ViewManager extends EventEmitter {
  private views: Map<number, ViewInfo> = new Map();
  private mainWindow: BrowserWindow | null = null;
  private nextViewId = 1;
  private tilingConfig: TilingConfig;
  private workspaceBounds: Bounds = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
  };

  // Static cache for design system CSS (loaded once, reused for all views)
  private static designSystemCSSCache: string | null = null;
  private static designSystemCSSPath: string | null = null;

  constructor(tilingConfig?: TilingConfig) {
    super();
    this.tilingConfig = tilingConfig || {
      mode: "none",
      gap: 0,
      padding: 0,
    };
  }

  /**
   * Set the main window that will host the views
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
    // Register shortcut to open DevTools for focused view: Ctrl+Shift+D
    try {
      // Use accelerator consistent with Electron on Linux/Windows/macOS
      const accelerator = "CommandOrControl+Shift+D";
      // Avoid multiple registrations
      if (!globalShortcut.isRegistered(accelerator)) {
        globalShortcut.register(accelerator, () => {
          const focusedView = this.findFocusedView();
          if (focusedView) {
            try {
              focusedView.webContents.openDevTools();
              console.log("Opened DevTools for focused view");
            } catch (err) {
              console.error("Failed to open DevTools for focused view:", err);
            }
          } else {
            console.log("No focused view found to open DevTools");
          }
        });
      }
    } catch (err) {
      console.error("Failed to register global shortcut for DevTools:", err);
    }

    // Cleanup when main window is closed/destroyed
    window.on("closed", () => {
      try {
        const accelerator = "CommandOrControl+Shift+D";
        if (globalShortcut.isRegistered(accelerator)) {
          globalShortcut.unregister(accelerator);
        }
      } catch (err) {
        console.error("Failed to unregister global shortcut:", err);
      }
    });
  }

  /**
   * Find the focused WebContentsView (if any) among managed views.
   */
  private findFocusedView(): WebContentsView | undefined {
    for (const info of this.views.values()) {
      try {
        if (
          !info.view.webContents.isDestroyed() &&
          info.view.webContents.isFocused()
        ) {
          return info.view;
        }
      } catch (err) {
        // ignore checks that fail when webcontents is not available
      }
    }
    return undefined;
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
   * Get the next available z-index for floating windows
   */
  private getNextZIndex(): number {
    const zIndices = Array.from(this.views.values())
      .filter((v) => v.mode === "floating" && v.zIndex !== undefined)
      .map((v) => v.zIndex!);

    if (zIndices.length === 0) return 1;
    return Math.max(...zIndices) + 1;
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
   * Calculate initial bounds for a floating window
   */
  private calculateFloatingBounds(windowConfig?: WindowConfig): Bounds {
    const {
      x: workX,
      y: workY,
      width: workWidth,
      height: workHeight,
    } = this.workspaceBounds;

    // Get default size from config or use reasonable defaults
    const width = windowConfig?.defaultSize?.width || 800;
    const height = windowConfig?.defaultSize?.height || 600;

    // Apply min/max constraints
    const finalWidth = windowConfig?.minSize?.width
      ? Math.max(width, windowConfig.minSize.width)
      : windowConfig?.maxSize?.width
        ? Math.min(width, windowConfig.maxSize.width)
        : width;

    const finalHeight = windowConfig?.minSize?.height
      ? Math.max(height, windowConfig.minSize.height)
      : windowConfig?.maxSize?.height
        ? Math.min(height, windowConfig.maxSize.height)
        : height;

    // Get position from config or center the window
    let x: number, y: number;
    if (windowConfig?.defaultPosition) {
      x = workX + windowConfig.defaultPosition.x;
      y = workY + windowConfig.defaultPosition.y;
    } else {
      // Center the window in the workspace
      x = workX + (workWidth - finalWidth) / 2;
      y = workY + (workHeight - finalHeight) / 2;
    }

    // Apply offset to cascade windows
    const floatingCount = Array.from(this.views.values()).filter(
      (v) => v.mode === "floating"
    ).length;
    const offset = floatingCount * 30; // Cascade offset
    x += offset;
    y += offset;

    return { x, y, width: finalWidth, height: finalHeight } as Bounds;
  }

  /**
   * Inject app API into the view's webContents
   * Sends the channel info so the universal preload can set up the API
   */
  private injectAppAPI(view: WebContentsView, appId: string): void {
    const channel = `app-${appId}`;
    const requestChannel = `app-${appId}-request`;

    view.webContents.send("init-app-api", {
      appId,
      channel,
      requestChannel,
    });

    console.log(`Sent app API init for ${appId}`);
  }

  /**
   * Clear the cached design system CSS
   * Useful for development or when CSS is updated
   */
  public static clearDesignSystemCache(): void {
    ViewManager.designSystemCSSCache = null;
    console.log("Design system CSS cache cleared");
  }

  /**
   * Inject Eden Design System CSS into the view
   * Makes design tokens and utilities available to all apps
   *
   * Uses a static cache to avoid reading the CSS file multiple times.
   * The CSS is loaded once on first injection, then reused for all subsequent views.
   */
  private async injectDesignSystemCSS(view: WebContentsView): Promise<void> {
    try {
      // Initialize cache path if not set
      if (!ViewManager.designSystemCSSPath) {
        const designSystemPath = path.join(__dirname, "../../design-system");
        ViewManager.designSystemCSSPath = path.join(
          designSystemPath,
          "eden.css"
        );
      }

      // Load CSS from cache or read from disk on first call
      if (!ViewManager.designSystemCSSCache) {
        console.log("Loading Eden Design System CSS from disk...");
        ViewManager.designSystemCSSCache = await fs.readFile(
          ViewManager.designSystemCSSPath,
          "utf-8"
        );
        const sizeKB = (ViewManager.designSystemCSSCache.length / 1024).toFixed(
          2
        );
        console.log(
          `✓ Loaded Eden CSS: ${sizeKB} KB (cached for future views)`
        );
      }

      // Inject the cached CSS
      await view.webContents.insertCSS(ViewManager.designSystemCSSCache);

      console.log(
        "Successfully injected Eden Design System CSS into view (from cache)"
      );
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
      const frameScriptPath = path.join(
        __dirname,
        "../../eveshell/app-frame-inject.js"
      );
      const frameScript = await fs.readFile(frameScriptPath, "utf-8");

      // Inject the frame script with window mode, config, and initial bounds
      await view.webContents.executeJavaScript(`
                window.__edenWindowMode = "${viewMode}";
                window.__edenWindowConfig = ${JSON.stringify(
                  windowConfig || {}
                )};
                window.__edenInitialBounds = ${JSON.stringify(bounds || {})};
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
   * Create a view for an app
   */
  createView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds
  ): number {
    if (!this.mainWindow) {
      throw new Error("Main window not set. Call setMainWindow first.");
    }

    // Use universal preload that provides safe API
    const universalPreload = path.join(
      __dirname,
      "../../eveshell/app-preload.js"
    );
    console.log(
      `Creating view for ${appId} with universal preload: ${universalPreload}`
    );

    const view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: false,
        preload: universalPreload,
        transparent: true,
        backgroundThrottling: false,
      },
    });

    const viewId = this.nextViewId++;

    // Determine view mode based on manifest
    const viewMode = this.determineViewMode(manifest);

    // Calculate bounds based on view mode
    let viewBounds = bounds;
    let tileIndex: number | undefined = undefined;
    let zIndex: number | undefined = undefined;

    if (viewMode === "floating") {
      // Floating window - calculate bounds from manifest or use defaults
      viewBounds = this.calculateFloatingBounds(manifest.window);
      zIndex = this.getNextZIndex();
      console.log(
        `Creating floating view for ${appId} with bounds:`,
        viewBounds
      );
    } else if (viewMode === "tiled") {
      // Tiled window - calculate tile position
      if (this.tilingConfig.mode !== "none") {
        tileIndex = this.getNextTileIndex();
        viewBounds = this.calculateTileBounds(tileIndex);
      }
      console.log(`Creating tiled view for ${appId} with bounds:`, viewBounds);
    }

    // Set bounds
    view.setBounds(viewBounds);

    // Load the frontend HTML
    const frontendPath = path.join(installPath, manifest.frontend.entry);
    view.webContents.loadFile(frontendPath);

    // Set up view event handlers
    view.webContents.on("did-finish-load", () => {
      // Inject the Eden Design System CSS first
      this.injectDesignSystemCSS(view).catch((err) => {
        console.error(`Failed to inject design system CSS for ${appId}:`, err);
      });

      // Inject the app frame script with window mode info and actual bounds
      this.injectAppFrame(view, viewMode, manifest.window, viewBounds);

      // Inject the app API after page load
      this.injectAppAPI(view, appId);
      this.emit("view-loaded", { viewId, appId });
    });

    view.webContents.on(
      "did-fail-load",
      (_event: any, errorCode: any, errorDescription: any) => {
        console.error(`View load failed for app ${appId}:`, errorDescription);
        this.emit("view-load-failed", {
          viewId,
          appId,
          errorCode,
          errorDescription,
        });
      }
    );

    // Store view info first (before adding to window)
    this.views.set(viewId, {
      view,
      appId,
      manifest,
      bounds: viewBounds,
      visible: true,
      mode: viewMode,
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
   * Remove a view
   */
  removeView(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      return false;
    }

    try {
      // Check if view is already destroyed
      if (!viewInfo.view.webContents.isDestroyed()) {
        // Only try to remove if mainWindow still exists and view is not destroyed
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.contentView.removeChildView(viewInfo.view);
        }
      }

      // Always remove from our tracking map
      this.views.delete(viewId);

      // Recalculate tiles if using tiling
      if (this.tilingConfig.mode !== "none") {
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
      let finalBounds = { ...bounds };

      if (windowConfig?.minSize) {
        finalBounds.width = Math.max(
          finalBounds.width,
          windowConfig.minSize.width
        );
        finalBounds.height = Math.max(
          finalBounds.height,
          windowConfig.minSize.height
        );
      }

      if (windowConfig?.maxSize) {
        finalBounds.width = Math.min(
          finalBounds.width,
          windowConfig.maxSize.width
        );
        finalBounds.height = Math.min(
          finalBounds.height,
          windowConfig.maxSize.height
        );
      }

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
        viewInfo.zIndex = this.getNextZIndex();
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
   * - Tiled views on bottom
   * - Floating views on top, ordered by zIndex
   */
  private reorderViewLayers(): void {
    if (!this.mainWindow) return;

    try {
      // Get all views sorted by layer
      const tiledViews = Array.from(this.views.values())
        .filter((v) => v.mode === "tiled")
        .sort((a, b) => (a.tileIndex || 0) - (b.tileIndex || 0));

      const floatingViews = Array.from(this.views.values())
        .filter((v) => v.mode === "floating")
        .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

      // Remove all views
      for (const info of this.views.values()) {
        this.mainWindow.contentView.removeChildView(info.view);
      }

      // Add back in order: tiled first (bottom), then floating (top)
      for (const info of tiledViews) {
        this.mainWindow.contentView.addChildView(info.view);
        info.view.setBounds(info.bounds);
      }

      for (const info of floatingViews) {
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
        // For floating views, set to lowest zIndex among floating windows
        const floatingViews = Array.from(this.views.values()).filter(
          (v) => v.mode === "floating" && v.zIndex !== undefined
        );
        const minZIndex = Math.min(...floatingViews.map((v) => v.zIndex!));
        viewInfo.zIndex = minZIndex - 1;
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
        // For floating views, adjust zIndex within floating layer
        const floatingViews = Array.from(this.views.values())
          .filter((v) => v.mode === "floating" && v.zIndex !== undefined)
          .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

        const targetIndex = Math.max(
          0,
          Math.min(position, floatingViews.length - 1)
        );
        // Set zIndex based on position
        const baseZIndex = floatingViews[0]?.zIndex || 1;
        viewInfo.zIndex = baseZIndex + targetIndex;
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
        const floatingBounds = this.calculateFloatingBounds(windowConfig);
        viewInfo.bounds = floatingBounds;
        viewInfo.zIndex = this.getNextZIndex();
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

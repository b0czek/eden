import { BrowserWindow, WebContentsView, globalShortcut } from "electron";
import { EventEmitter } from "events";
import * as path from "path";
import * as fs from "fs/promises";
import { AppManifest, TilingConfig, WindowConfig } from "../../types";

type ViewMode = "floating" | "tiled";

interface ViewInfo {
  view: WebContentsView;
  appId: string;
  manifest: AppManifest;
  bounds: { x: number; y: number; width: number; height: number };
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
  private workspaceBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } = { x: 0, y: 0, width: 800, height: 600 };

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
              focusedView.webContents.openDevTools({
                mode: "right",
              });
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
  setWorkspaceBounds(bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  }): void {
    this.workspaceBounds = bounds;
    // Recalculate all tile bounds if using tiling
    if (this.tilingConfig.mode !== "none") {
      this.recalculateTiledViews();
    }
  }

  /**
   * Calculate bounds for a tile based on tiling configuration
   */
  private calculateTileBounds(tileIndex: number): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    const {
      mode,
      gap = 0,
      padding = 0,
      columns = 2,
      rows = 2,
    } = this.tilingConfig;
    const {
      x: workX,
      y: workY,
      width: workWidth,
      height: workHeight,
    } = this.workspaceBounds;

    // Apply padding
    const availableX = workX + padding;
    const availableY = workY + padding;
    const availableWidth = workWidth - padding * 2;
    const availableHeight = workHeight - padding * 2;

    switch (mode) {
      case "horizontal": {
        // Split horizontally into equal tiles (only count tiled views)
        const visibleTiledViews = Array.from(this.views.values()).filter(
          (v) => v.visible && v.mode === "tiled"
        );
        const count = visibleTiledViews.length;
        if (count === 0)
          return {
            x: availableX,
            y: availableY,
            width: availableWidth,
            height: availableHeight,
          };

        const tileWidth = (availableWidth - gap * (count - 1)) / count;
        return {
          x: availableX + tileIndex * (tileWidth + gap),
          y: availableY,
          width: tileWidth,
          height: availableHeight,
        };
      }

      case "vertical": {
        // Split vertically into equal tiles (only count tiled views)
        const visibleTiledViews = Array.from(this.views.values()).filter(
          (v) => v.visible && v.mode === "tiled"
        );
        const count = visibleTiledViews.length;
        if (count === 0)
          return {
            x: availableX,
            y: availableY,
            width: availableWidth,
            height: availableHeight,
          };

        const tileHeight = (availableHeight - gap * (count - 1)) / count;
        return {
          x: availableX,
          y: availableY + tileIndex * (tileHeight + gap),
          width: availableWidth,
          height: tileHeight,
        };
      }

      case "grid": {
        // Grid layout
        const col = tileIndex % columns;
        const row = Math.floor(tileIndex / columns);
        const tileWidth = (availableWidth - gap * (columns - 1)) / columns;
        const tileHeight = (availableHeight - gap * (rows - 1)) / rows;

        return {
          x: availableX + col * (tileWidth + gap),
          y: availableY + row * (tileHeight + gap),
          width: tileWidth,
          height: tileHeight,
        };
      }

      default:
        // No tiling, return full workspace
        return {
          x: availableX,
          y: availableY,
          width: availableWidth,
          height: availableHeight,
        };
    }
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
  private calculateFloatingBounds(windowConfig?: WindowConfig): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
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

    return { x, y, width: finalWidth, height: finalHeight };
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
   * Inject app frame script into the view
   * This adds a title bar with close button to each app
   */
  private async injectAppFrame(
    view: WebContentsView,
    viewMode: ViewMode,
    windowConfig?: WindowConfig,
    bounds?: { x: number; y: number; width: number; height: number }
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
    bounds: { x: number; y: number; width: number; height: number }
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

    // Add to main window's contentView
    this.mainWindow.contentView.addChildView(view);

    // Store view info
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
  setViewBounds(
    viewId: number,
    bounds: { x: number; y: number; width: number; height: number }
  ): boolean {
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
      } else {
        // Floating view - bring to front and update z-index
        // Remove and re-add to bring to front
        this.mainWindow.contentView.removeChildView(viewInfo.view);
        this.mainWindow.contentView.addChildView(viewInfo.view);
        // Update z-index to be on top
        viewInfo.zIndex = this.getNextZIndex();
        // Restore bounds
        viewInfo.view.setBounds(viewInfo.bounds);
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
   * Bring a view to the front (highest z-index)
   */
  bringToFront(viewId: number): boolean {
    return this.showView(viewId);
  }

  /**
   * Send a view to the back (lowest z-index)
   */
  sendToBack(viewId: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      // Get all child views
      const allViews = Array.from(this.views.values()).map((v) => v.view);

      // Remove all views
      for (const v of allViews) {
        this.mainWindow.contentView.removeChildView(v);
      }

      // Add target view first (back), then all others
      this.mainWindow.contentView.addChildView(viewInfo.view);
      viewInfo.view.setBounds(viewInfo.bounds);

      for (const v of allViews) {
        if (v !== viewInfo.view) {
          this.mainWindow.contentView.addChildView(v);
          // Restore bounds from stored info
          const info = Array.from(this.views.values()).find(
            (i) => i.view === v
          );
          if (info) {
            v.setBounds(info.bounds);
          }
        }
      }

      return true;
    } catch (error) {
      console.error(`Failed to send view ${viewId} to back:`, error);
      return false;
    }
  }

  /**
   * Set the z-order of a view relative to other views
   * @param viewId - The view to reorder
   * @param position - Position in z-order (0 = back, higher = more front)
   */
  setZOrder(viewId: number, position: number): boolean {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo || !this.mainWindow) {
      return false;
    }

    try {
      const allViews = Array.from(this.views.values()).map((v) => v.view);
      const targetIndex = Math.max(0, Math.min(position, allViews.length - 1));

      // Remove all views
      for (const v of allViews) {
        this.mainWindow.contentView.removeChildView(v);
      }

      // Re-add in desired order
      const otherViews = allViews.filter((v) => v !== viewInfo.view);
      const orderedViews = [
        ...otherViews.slice(0, targetIndex),
        viewInfo.view,
        ...otherViews.slice(targetIndex),
      ];

      for (const v of orderedViews) {
        this.mainWindow.contentView.addChildView(v);
        const info = Array.from(this.views.values()).find((i) => i.view === v);
        if (info) {
          v.setBounds(info.bounds);
        }
      }

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

        // Bring to front (floating windows are on top)
        this.mainWindow.contentView.removeChildView(viewInfo.view);
        this.mainWindow.contentView.addChildView(viewInfo.view);
        viewInfo.view.setBounds(floatingBounds);

        // Recalculate remaining tiled views
        if (this.tilingConfig.mode !== "none") {
          this.recalculateTiledViews();
        }

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

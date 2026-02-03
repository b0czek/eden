import { BrowserWindow, Rectangle as Bounds, WebContentsView } from "electron";
import { AppManifest, EdenConfig, WindowSize, ViewBounds } from "@edenapp/types";
import { log } from "../logging";
import { attachWebContentsLogger } from "../logging/electron";
import { FloatingWindowController } from "./FloatingWindowController";
import { DevToolsManager } from "./DevToolsManager";
import { TilingManager } from "./TilingManager";
import { ViewCreator } from "./ViewCreator";
import {
  cleanupDestroyedViews,
  destroyView,
  isViewAlive,
  isWindowAlive,
  requireView,
} from "./viewLifecycle";
import { ViewInfo, ViewMode } from "./types";

import { injectable, inject, singleton, delay } from "tsyringe";
import { CommandRegistry, IPCBridge, EdenEmitter, EdenNamespace } from "../ipc";
import { ViewHandler } from "./ViewHandler";

/**
 * Events emitted by the ViewManager
 */
interface ViewManagerEvents {
  "view-loaded": { viewId: number; appId: string; overlay: boolean };
  "view-load-failed": {
    viewId: number;
    appId: string;
    errorCode: number;
    errorDescription: string;
  };
  "mode-changed": { mode: "floating" | "tiled"; bounds: ViewBounds };
}

/**
 * ViewManager
 *
 * Central orchestrator for view management in Eden.
 */
@singleton()
@injectable()
@EdenNamespace("view")
export class ViewManager extends EdenEmitter<ViewManagerEvents> {
  private views: Map<number, ViewInfo> = new Map();
  private mainWindow: BrowserWindow | null = null;

  // Specialized modules
  private readonly tilingManager: TilingManager;
  private readonly floatingWindows: FloatingWindowController;
  private readonly viewCreator: ViewCreator;
  private readonly devToolsManager: DevToolsManager;

  private windowSize: WindowSize = { width: 800, height: 600 };
  private viewHandler: ViewHandler;

  constructor(
    @inject(CommandRegistry) commandRegistry: CommandRegistry,
    @inject(delay(() => IPCBridge)) ipcBridge: IPCBridge,
    @inject("EdenConfig") config: EdenConfig,
    @inject("distPath") distPath: string
  ) {
    super(ipcBridge);

    // Initialize specialized modules
    const tilingConfig = config.tiling || { mode: "none", gap: 0, padding: 0 };
    this.tilingManager = new TilingManager(tilingConfig);
    this.devToolsManager = new DevToolsManager();

    this.floatingWindows = new FloatingWindowController(
      () => this.tilingManager.getWorkspaceBounds(),
      () => this.views.values()
    );

    // Use consumer's dist path for runtime assets
    this.viewCreator = new ViewCreator(
      distPath,
      this.tilingManager,
      this.floatingWindows,
      this.devToolsManager
    );

    // Create and register handler
    this.viewHandler = new ViewHandler(this, ipcBridge);
    commandRegistry.registerManager(this.viewHandler);
  }

  private markViewFocused(viewInfo: ViewInfo): void {
    viewInfo.lastFocusedAt = Date.now();
  }

  private attachFocusTracking(viewId: number, viewInfo: ViewInfo): void {
    viewInfo.view.webContents.on("focus", () => {
      const trackedView = this.views.get(viewId);
      if (!trackedView) return;
      this.markViewFocused(trackedView);
    });
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
    this.tilingManager.setWorkspaceBounds(bounds);
    if (this.tilingManager.isEnabled()) {
      this.tilingManager.recalculateTiledViews(this.views);
    }
  }

  setWindowSize(windowSize: WindowSize): void {
    this.windowSize = windowSize;
  }

  getWindowSize(): WindowSize {
    return this.windowSize;
  }

  /**
   * Create a view for an app or overlay
   */
  public createView(
    appId: string,
    manifest: AppManifest,
    installPath: string,
    bounds: Bounds | undefined,
    launchArgs?: string[]
  ): number {
    if (!isWindowAlive(this.mainWindow)) {
      throw new Error("Main window not set. Call setMainWindow first.");
    }

    const viewInfo = this.viewCreator.createView(
      appId,
      manifest,
      installPath,
      bounds,
      this.views.values(),
      launchArgs
    );

    const viewId = viewInfo.id;

    attachWebContentsLogger(viewInfo.view.webContents, {
      appId,
      viewId,
      source: viewInfo.viewType === "overlay" ? "overlay" : "app",
    });

    // Store view info
    this.views.set(viewId, viewInfo);
    this.attachFocusTracking(viewId, viewInfo);

    // Electron event listener for view load failure
    viewInfo.view.webContents.on(
      "did-fail-load",
      (_event: any, errorCode: any, errorDescription: any) => {
        log.error(
          `View load failed for ${appId}:`,
          errorDescription
        );
        this.notify("view-load-failed", {
          viewId: viewInfo.id,
          appId,
          errorCode,
          errorDescription,
        });
      }
    );

    // Notify listeners that the view has been loaded
    this.notify("view-loaded", {
      viewId: viewInfo.id,
      appId,
      overlay: viewInfo.viewType === "overlay",
    });

    // Recalculate all tiles if using tiling and this is a tiled view
    if (viewInfo.mode === "tiled" && this.tilingManager.isEnabled()) {
      this.tilingManager.applyTiledCapacity(
        this.views,
        viewId,
        (hideId) => this.hideView(hideId)
      );
    }

    // Add to main window's contentView and maintain proper layering
    this.reorderViewLayers();

    return viewId;
  }

  /**
   * Remove a view
   */
  removeView(viewId: number): void {
    const viewInfo = this.views.get(viewId);
    if (!viewInfo) {
      throw new Error(`View ${viewId} not found`);
    }

    try {
      // Close DevTools if open
      this.devToolsManager.closeDevToolsForView(viewInfo.view);

      // Destroy the view safely
      destroyView(viewInfo, this.mainWindow);

      // Clean up all event subscriptions for this view
      this.ipcBridge.eventSubscribers.removeViewSubscriptions(viewId);

      // Remove from tracking map
      this.views.delete(viewId);

      // Recalculate tiles if using tiling and this was an app view
      if (viewInfo.viewType === "app" && this.tilingManager.isEnabled()) {
        this.tilingManager.recalculateTiledViews(this.views);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error(
        `Failed to remove view ${viewId}:`,
        errorMessage
      );
      // Still remove from tracking even if removal failed
      this.views.delete(viewId);
      throw new Error(`Failed to remove view: ${errorMessage}`);
    }
  }

  /**
   * Update view bounds
   */
  setViewBounds(viewId: number, bounds: Bounds): void {
    const viewInfo = requireView(viewId, this.views);

    // If this is an overlay view, set bounds directly without constraints
    if (viewInfo.viewType === "overlay") {
      try {
        viewInfo.view.setBounds(bounds);
        viewInfo.bounds = bounds;
        return;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to set overlay bounds: ${errorMessage}`);
      }
    }

    // If this is a tiled view, ignore individual bounds updates
    if (viewInfo.mode === "tiled") {
      log.info(
        `Ignoring individual bounds update for tiled view ${viewId}`
      );
      return;
    }

    // For floating views, allow bounds updates
    if (!viewInfo.visible) {
      viewInfo.bounds = bounds;
      return;
    }

    try {
      const windowConfig = viewInfo.manifest.window;
      const finalBounds = this.floatingWindows.applyWindowConstraints(
        bounds,
        windowConfig
      );
      viewInfo.view.setBounds(finalBounds);
      viewInfo.bounds = finalBounds;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to set bounds: ${errorMessage}`);
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
  showView(viewId: number): void {
    const viewInfo = requireView(viewId, this.views);

    try {
      viewInfo.visible = true;

      if (viewInfo.mode === "tiled") {
        this.tilingManager.applyTiledCapacity(
          this.views,
          viewId,
          (hideId) => this.hideView(hideId)
        );
        this.reorderViewLayers();
      } else {
        viewInfo.zIndex = this.floatingWindows.getNextZIndex();
        this.reorderViewLayers();
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to show view: ${errorMessage}`);
    }
  }

  /**
   * Focus a view's webContents (does not change bounds).
   */
  focusView(viewId: number): void {
    const viewInfo = requireView(viewId, this.views);
    if (viewInfo.view.webContents.isDestroyed()) return;
    viewInfo.view.webContents.focus();
  }

  /**
   * Hide a view by setting its bounds to zero
   */
  hideView(viewId: number): void {
    const viewInfo = requireView(viewId, this.views);

    try {
      viewInfo.visible = false;
      viewInfo.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });

      if (viewInfo.mode === "tiled") {
        this.tilingManager.recalculateTiledViews(this.views);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to hide view: ${errorMessage}`);
    }
  }

  /**
   * Reorder all views to maintain proper layering
   */
  private reorderViewLayers(): void {
    if (!isWindowAlive(this.mainWindow)) return;

    // Clean up any destroyed views first
    cleanupDestroyedViews(this.views);

    try {
      const appViews = Array.from(this.views.values()).filter(
        (v) => v.viewType === "app"
      );

      const tiledViews = appViews
        .filter((v) => v.mode === "tiled" && v.visible)
        .sort((a, b) => (a.tileIndex || 0) - (b.tileIndex || 0));

      const floatingAppViews = this.floatingWindows
        .getOrderedFloatingViews()
        .filter((v) => v.visible);

      const overlayViews = Array.from(this.views.values())
        .filter((v) => v.viewType === "overlay" && v.visible)
        .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

      // Remove all views
      for (const info of this.views.values()) {
        if (isViewAlive(info.view)) {
          this.mainWindow.contentView.removeChildView(info.view);
        }
      }

      // Add back in order: tiled (bottom), floating apps (middle), overlays (top)
      for (const info of tiledViews) {
        if (isViewAlive(info.view)) {
          this.mainWindow.contentView.addChildView(info.view);
          info.view.setBounds(info.bounds);
        }
      }

      for (const info of floatingAppViews) {
        if (isViewAlive(info.view)) {
          this.mainWindow.contentView.addChildView(info.view);
          info.view.setBounds(info.bounds);
        }
      }

      for (const info of overlayViews) {
        if (isViewAlive(info.view)) {
          this.mainWindow.contentView.addChildView(info.view);
          info.view.setBounds(info.bounds);
        }
      }
    } catch (error) {
      log.error("Failed to reorder view layers:", error);
    }
  }

  /**
   * Send message to view's webContents
   */
  sendToView(viewId: number, channel: string, ...args: any[]): boolean {
    try {
      const viewInfo = requireView(viewId, this.views);
      viewInfo.view.webContents.send(channel, ...args);
      return true;
    } catch (error) {
      log.error(
        `Failed to send message to view ${viewId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Send message to the main window (foundation layer)
   */
  sendToMainWindow(channel: string, ...args: any[]): boolean {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.webContents.send(channel, ...args);
        return true;
      } catch (error) {
        log.error(`Failed to send to main window:`, error);
        return false;
      }
    }
    return false;
  }

  /**
   * Get all active view IDs
   */
  getActiveViews(): number[] {
    return Array.from(this.views.keys());
  }

  /**
   * Toggle or set view mode between tiled and floating
   */
  setViewMode(viewId: number, targetMode?: ViewMode): void {
    const viewInfo = requireView(viewId, this.views);
    const manifest = viewInfo.manifest;
    const windowConfig = manifest.window;

    // Determine target mode
    const newMode: ViewMode =
      targetMode || (viewInfo.mode === "floating" ? "tiled" : "floating");

    // Check if the app supports this mode
    if (windowConfig?.mode) {
      if (windowConfig.mode === "floating" && newMode === "tiled") {
        throw new Error(`App ${viewInfo.appId} only supports floating mode`);
      }
      if (windowConfig.mode === "tiled" && newMode === "floating") {
        throw new Error(`App ${viewInfo.appId} only supports tiled mode`);
      }
    }

    // If already in target mode, do nothing
    if (viewInfo.mode === newMode) {
      return;
    }

    log.info(
      `Switching view ${viewId} from ${viewInfo.mode} to ${newMode} mode`
    );

    try {
      if (newMode === "floating") {
        viewInfo.tileIndex = undefined;
        const floatingBounds =
          this.floatingWindows.calculateInitialBounds(windowConfig);
        viewInfo.bounds = floatingBounds;
        viewInfo.zIndex = this.floatingWindows.getNextZIndex();
        viewInfo.mode = "floating";
        viewInfo.view.setBounds(floatingBounds);

        if (this.tilingManager.isEnabled()) {
          this.tilingManager.recalculateTiledViews(this.views);
        }

        this.reorderViewLayers();
        this.notifySubscriber(viewId, "mode-changed", {
          mode: "floating",
          bounds: floatingBounds,
        });
      } else {
        viewInfo.zIndex = undefined;

        if (this.tilingManager.isEnabled()) {
          viewInfo.tileIndex = this.tilingManager.getNextTileIndex(
            this.views.values()
          );
          const visibleCount = this.tilingManager.getVisibleTiledCount(
            this.views.values()
          );
          const tileBounds = this.tilingManager.calculateTileBounds(
            viewInfo.tileIndex,
            visibleCount
          );
          viewInfo.bounds = tileBounds;
          viewInfo.mode = "tiled";
          viewInfo.view.setBounds(tileBounds);
          this.tilingManager.applyTiledCapacity(
            this.views,
            viewId,
            (hideId) => this.hideView(hideId)
          );
          this.reorderViewLayers();
          this.notifySubscriber(viewId, "mode-changed", {
            mode: "tiled",
            bounds: tileBounds,
          });
        } else {
          const bounds = { ...this.tilingManager.getWorkspaceBounds() };
          viewInfo.bounds = bounds;
          viewInfo.mode = "tiled";
          viewInfo.view.setBounds(bounds);
          this.reorderViewLayers();
          this.notifySubscriber(viewId, "mode-changed", {
            mode: "tiled",
            bounds,
          });
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to switch mode: ${errorMessage}`);
    }
  }
}

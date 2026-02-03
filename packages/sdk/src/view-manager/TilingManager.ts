import { Rectangle as Bounds } from "electron";
import { TilingConfig } from "@edenapp/types";
import { ViewInfo, ViewMode } from "./types";
import { calculateTileBounds } from "./layoutCalculator";
import { injectable, singleton } from "tsyringe";

/**
 * TilingManager
 *
 * Handles tiling calculations and view positioning for tiled window mode.
 * Extracted from ViewManager for better separation of concerns.
 */
@singleton()
@injectable()
export class TilingManager {
  private config: TilingConfig;
  private workspaceBounds: Bounds;

  constructor(
    config: TilingConfig = { mode: "none", gap: 0, padding: 0 },
    workspaceBounds: Bounds = { x: 0, y: 0, width: 800, height: 600 }
  ) {
    this.config = config;
    this.workspaceBounds = workspaceBounds;
  }

  /**
   * Update the workspace bounds used for tile calculations
   */
  setWorkspaceBounds(bounds: Bounds): void {
    this.workspaceBounds = bounds;
  }

  /**
   * Get current workspace bounds
   */
  getWorkspaceBounds(): Bounds {
    return this.workspaceBounds;
  }

  /**
   * Update tiling configuration
   */
  setConfig(config: TilingConfig): void {
    this.config = config;
  }

  /**
   * Get current tiling configuration
   */
  getConfig(): TilingConfig {
    return this.config;
  }

  /**
   * Check if tiling is enabled
   */
  isEnabled(): boolean {
    return this.config.mode !== "none";
  }

  /**
   * Get the maximum number of visible tiled views allowed by configuration.
   * Returns undefined when capacity is unlimited for the current mode.
   */
  getTiledCapacity(): number | undefined {
    if (!this.isEnabled()) return undefined;

    const { mode, columns, rows } = this.config;

    const normalizeCount = (value: number | undefined, fallback: number) => {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return fallback;
      }
      return Math.max(1, Math.floor(value));
    };

    switch (mode) {
      case "grid": {
        const safeColumns = normalizeCount(columns, 2);
        const safeRows = normalizeCount(rows, 2);
        return safeColumns * safeRows;
      }
      case "horizontal": {
        if (columns === undefined) return undefined;
        return normalizeCount(columns, 1);
      }
      case "vertical": {
        if (rows === undefined) return undefined;
        return normalizeCount(rows, 1);
      }
      default:
        return undefined;
    }
  }

  /**
   * Determine which tiled app views should be hidden to respect capacity.
   * Returns a list of view IDs to hide (oldest focus first).
   */
  enforceTiledCapacity(
    views: Map<number, ViewInfo>,
    preferredViewId?: number
  ): number[] {
    if (!this.isEnabled()) return [];

    const capacity = this.getTiledCapacity();
    if (capacity === undefined) return [];

    const visibleTiledApps = Array.from(views.values()).filter(
      (view) => view.viewType === "app" && view.mode === "tiled" && view.visible
    );

    if (visibleTiledApps.length <= capacity) return [];

    const candidates = visibleTiledApps
      .filter((view) => view.id !== preferredViewId)
      .sort((a, b) => (a.lastFocusedAt ?? 0) - (b.lastFocusedAt ?? 0));

    let remaining = visibleTiledApps.length;
    const toHide: number[] = [];

    for (const candidate of candidates) {
      if (remaining <= capacity) break;
      toHide.push(candidate.id);
      remaining -= 1;
    }

    if (remaining > capacity && preferredViewId !== undefined) {
      const preferred = views.get(preferredViewId);
      if (
        preferred &&
        preferred.visible &&
        preferred.mode === "tiled" &&
        preferred.viewType === "app"
      ) {
        toHide.push(preferredViewId);
      }
    }

    return toHide;
  }

  /**
   * Apply capacity rules and recalculate tiles when no views were hidden.
   * Returns true if any views were hidden.
   */
  applyTiledCapacity(
    views: Map<number, ViewInfo>,
    preferredViewId: number | undefined,
    hideView: (viewId: number) => void
  ): boolean {
    const toHide = this.enforceTiledCapacity(views, preferredViewId);
    if (toHide.length > 0) {
      for (const viewId of toHide) {
        hideView(viewId);
      }
      return true;
    }

    this.recalculateTiledViews(views);
    return false;
  }

  /**
   * Calculate bounds for a tile based on tiling configuration
   * @param tileIndex - Index of the tile to calculate
   * @param visibleCount - Total number of visible tiled views
   */
  calculateTileBounds(tileIndex: number, visibleCount: number): Bounds {
    return calculateTileBounds({
      workspace: this.workspaceBounds,
      tileIndex,
      visibleCount,
      config: this.config,
    });
  }

  /**
   * Get the next available tile index from a collection of views
   * @param views - Iterable of view information
   */
  getNextTileIndex(views: Iterable<ViewInfo>): number {
    const indices = Array.from(views)
      .filter(
        (v) => v.visible && v.mode === "tiled" && v.tileIndex !== undefined
      )
      .map((v) => v.tileIndex!);

    if (indices.length === 0) return 0;
    return Math.max(...indices) + 1;
  }

  /**
   * Get count of visible tiled views
   * @param views - Iterable of view information
   */
  getVisibleTiledCount(views: Iterable<ViewInfo>): number {
    return Array.from(views).filter((v) => v.visible && v.mode === "tiled")
      .length;
  }

  /**
   * Recalculate bounds for all tiled views
   * Returns updated views with new bounds applied
   * @param views - Map of viewId to ViewInfo
   */
  recalculateTiledViews(views: Map<number, ViewInfo>): void {
    if (!this.isEnabled()) return;

    // Get visible tiled views sorted by tile index
    const visibleViews = Array.from(views.entries())
      .filter(([_, info]) => info.visible && info.mode === "tiled")
      .sort((a, b) => (a[1].tileIndex || 0) - (b[1].tileIndex || 0));

    const visibleCount = visibleViews.length;

    visibleViews.forEach(([viewId, info], index) => {
      const bounds = this.calculateTileBounds(index, visibleCount);
      info.tileIndex = index;
      info.bounds = bounds;

      // Only set bounds if view is not destroyed
      if (!info.view.webContents.isDestroyed()) {
        info.view.setBounds(bounds);
      }
    });
  }

  /**
   * Determine view mode based on manifest window config and tiling state
   */
  determineViewMode(windowMode?: "floating" | "tiled" | "both"): ViewMode {
    // If no window config mode specified
    if (!windowMode) {
      return this.isEnabled() ? "tiled" : "floating";
    }

    // Check what the app supports
    switch (windowMode) {
      case "floating":
        return "floating";
      case "tiled":
        return "tiled";
      case "both":
        // If app supports both, prefer tiled if tiling is enabled
        return this.isEnabled() ? "tiled" : "floating";
      default:
        return this.isEnabled() ? "tiled" : "floating";
    }
  }
}

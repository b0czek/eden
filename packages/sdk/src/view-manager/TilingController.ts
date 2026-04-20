import type { TilingConfig } from "@edenapp/types";
import type { Rectangle as Bounds } from "electron";
import {
  calculateTileBounds,
  getSmartTilingCapacity,
} from "./layoutCalculator";
import type { ViewInfo, ViewMode } from "./types";

/**
 * TilingController
 *
 * Handles tiling calculations and view positioning for tiled window mode.
 * Extracted from ViewManager for better separation of concerns.
 */
export class TilingController {
  private config: TilingConfig;
  private workspaceBounds: Bounds;

  constructor(
    config: TilingConfig = { mode: "none", gap: 0, padding: 0 },
    workspaceBounds: Bounds = { x: 0, y: 0, width: 800, height: 600 },
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
      case "smart":
        return getSmartTilingCapacity(this.workspaceBounds, this.config);
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
   * Resolve which tiled app views should change visibility to match the
   * current capacity without needlessly swapping already visible views.
   */
  resolveTiledVisibilityChanges(
    views: Map<number, ViewInfo>,
    options: {
      preferredViewId?: number;
      excludedViewId?: number;
    } = {},
  ): { toHide: number[]; toShow: number[] } {
    if (!this.isEnabled()) return { toHide: [], toShow: [] };

    const capacity = this.getTiledCapacity() ?? Number.POSITIVE_INFINITY;

    const { preferredViewId, excludedViewId } = options;

    const tiledApps = Array.from(views.values()).filter(
      (view) =>
        view.viewType === "app" &&
        view.mode === "tiled" &&
        view.id !== excludedViewId,
    );
    const requestedTiledApps = tiledApps.filter(
      (view) => view.requestedVisible,
    );
    const visibleTiledApps = tiledApps.filter((view) => view.visible);
    const hiddenRequestedTiledApps = requestedTiledApps.filter(
      (view) => !view.visible,
    );

    const desiredVisibleIds = new Set(
      requestedTiledApps.filter((view) => view.visible).map((view) => view.id),
    );

    const removalCandidates = visibleTiledApps
      .filter((view) => view.id !== preferredViewId)
      .sort((a, b) => {
        const focusDelta = (a.lastFocusedAt ?? 0) - (b.lastFocusedAt ?? 0);
        if (focusDelta !== 0) return focusDelta;

        const tileDelta =
          (a.tileIndex ?? Number.MAX_SAFE_INTEGER) -
          (b.tileIndex ?? Number.MAX_SAFE_INTEGER);
        if (tileDelta !== 0) return tileDelta;

        return a.id - b.id;
      });

    const popOldestVisible = (): boolean => {
      for (const candidate of removalCandidates) {
        if (!desiredVisibleIds.has(candidate.id)) {
          continue;
        }
        desiredVisibleIds.delete(candidate.id);
        return true;
      }
      return false;
    };

    const preferredView =
      preferredViewId !== undefined ? views.get(preferredViewId) : undefined;
    const preferredIsTiledApp =
      preferredView?.viewType === "app" &&
      preferredView.mode === "tiled" &&
      preferredView.requestedVisible &&
      preferredView.id !== excludedViewId;
    const preferredAlreadyVisible =
      preferredViewId !== undefined && desiredVisibleIds.has(preferredViewId);

    if (
      preferredViewId !== undefined &&
      preferredIsTiledApp &&
      !preferredAlreadyVisible
    ) {
      while (desiredVisibleIds.size >= capacity && popOldestVisible()) {
        // Make room for the preferred tiled view before adding it back.
      }
      if (desiredVisibleIds.size < capacity) {
        desiredVisibleIds.add(preferredViewId);
      }
    }

    while (desiredVisibleIds.size > capacity && popOldestVisible()) {
      // Trim overflow without disturbing the preferred view when possible.
    }

    const additionCandidates = hiddenRequestedTiledApps
      .filter((view) => view.id !== preferredViewId)
      .sort((a, b) => {
        const focusDelta = (b.lastFocusedAt ?? 0) - (a.lastFocusedAt ?? 0);
        if (focusDelta !== 0) return focusDelta;

        const tileDelta =
          (a.tileIndex ?? Number.MAX_SAFE_INTEGER) -
          (b.tileIndex ?? Number.MAX_SAFE_INTEGER);
        if (tileDelta !== 0) return tileDelta;

        return a.id - b.id;
      });

    for (const candidate of additionCandidates) {
      if (desiredVisibleIds.size >= capacity) {
        break;
      }
      desiredVisibleIds.add(candidate.id);
    }

    return {
      toHide: visibleTiledApps
        .filter((view) => !desiredVisibleIds.has(view.id))
        .map((view) => view.id),
      toShow: hiddenRequestedTiledApps
        .filter((view) => desiredVisibleIds.has(view.id))
        .map((view) => view.id),
    };
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
        (v) => v.visible && v.mode === "tiled" && v.tileIndex !== undefined,
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

    visibleViews.forEach(([, info], index) => {
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

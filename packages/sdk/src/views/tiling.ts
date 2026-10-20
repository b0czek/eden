import type {
  TileLayoutDirection,
  TileLayoutState,
  TilingConfig,
  WindowConfig,
} from "@edenapp/types";
import type { Bounds } from "../platform/ports";
import {
  calculateTileBounds as calculateLayoutTileBounds,
  getSmartTilingCapacity,
} from "./layout";
import type { ViewInfo, ViewMode } from "./types";
export function createTiling(
  config: TilingConfig = { mode: "none", gap: 0, padding: 0 },
  workspaceBounds: Bounds = { x: 0, y: 0, width: 800, height: 600 },
  getInterfaceScale: () => number = () => 1,
) {
  let _config: TilingConfig;
  let _workspaceBounds: Bounds;
  const _expandedTiles = new Map<number, number>();
  const _getInterfaceScale = getInterfaceScale;

  _config = config;
  _workspaceBounds = workspaceBounds;

  function scaleForView(view: ViewInfo): number {
    return view.manifest.window?.scaling === "manual"
      ? 1
      : _getInterfaceScale();
  }

  function setWorkspaceBounds(bounds: Bounds): void {
    _workspaceBounds = bounds;
  }

  function getWorkspaceBounds(): Bounds {
    return _workspaceBounds;
  }

  function setConfig(config: TilingConfig): void {
    _config = config;
    if (config.mode === "none") {
      _expandedTiles.clear();
    }
  }

  function getConfig(): TilingConfig {
    return _config;
  }

  function isEnabled(): boolean {
    return _config.mode !== "none";
  }

  function normalizeCount(value: number | undefined, fallback: number): number {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return fallback;
    }
    return Math.max(1, Math.floor(value));
  }

  function getEffectiveSmartConstraints(views: Iterable<ViewInfo>): {
    minTileWidth: number;
    minTileHeight: number;
  } {
    const scale = _getInterfaceScale();
    const baseMinTileWidth = Math.max(
      1,
      Math.round((_config.minTileWidth ?? 600) * scale),
    );
    const baseMinTileHeight = Math.max(
      1,
      Math.round((_config.minTileHeight ?? 400) * scale),
    );

    let minTileWidth = baseMinTileWidth;
    let minTileHeight = baseMinTileHeight;

    for (const view of views) {
      if (view.mode !== "tiled" || view.viewType !== "app") continue;

      minTileWidth = Math.max(
        minTileWidth,
        Math.round(
          (view.manifest.window?.minSize?.width ?? 0) * scaleForView(view),
        ),
      );
      minTileHeight = Math.max(
        minTileHeight,
        Math.round(
          (view.manifest.window?.minSize?.height ?? 0) * scaleForView(view),
        ),
      );
    }

    return { minTileWidth, minTileHeight };
  }

  function getEffectiveConfig(views: Iterable<ViewInfo>): TilingConfig {
    if (_config.mode !== "smart") {
      return _config;
    }

    return {
      ..._config,
      ...getEffectiveSmartConstraints(views),
    };
  }

  function getSortedVisibleTiledViews(visibleViews: ViewInfo[]): ViewInfo[] {
    return [...visibleViews].sort(
      (a, b) =>
        (a.tileIndex ?? Number.MAX_SAFE_INTEGER) -
        (b.tileIndex ?? Number.MAX_SAFE_INTEGER),
    );
  }

  function calculateVisibleSetBounds(
    visibleViews: ViewInfo[],
  ): Map<number, Bounds> {
    const sortedVisibleViews = getSortedVisibleTiledViews(visibleViews);
    const visibleCount = sortedVisibleViews.length;
    const config = getEffectiveConfig(sortedVisibleViews);
    const boundsByViewId = new Map<number, Bounds>();

    sortedVisibleViews.forEach((view, index) => {
      const bounds = constrainTiledBounds(
        calculateLayoutTileBounds({
          workspace: _workspaceBounds,
          tileIndex: index,
          visibleCount,
          config,
        }),
        view,
      );
      boundsByViewId.set(view.id, bounds);
    });

    return boundsByViewId;
  }

  function getVisibleTiledViews(
    views: ReadonlyMap<number, ViewInfo>,
  ): ViewInfo[] {
    return getSortedVisibleTiledViews(
      Array.from(views.values()).filter(
        (view) =>
          view.viewType === "app" && view.visible && view.mode === "tiled",
      ),
    );
  }

  function getBaseLayout(views: ReadonlyMap<number, ViewInfo>): {
    visibleViews: ViewInfo[];
    boundsByViewId: Map<number, Bounds>;
  } {
    const visibleViews = getVisibleTiledViews(views);
    return {
      visibleViews,
      boundsByViewId: calculateVisibleSetBounds(visibleViews),
    };
  }

  function getNeighbor(
    sourceId: number,
    direction: TileLayoutDirection,
    visibleViews: ViewInfo[],
    boundsByViewId: Map<number, Bounds>,
  ): ViewInfo | undefined {
    const sourceBounds = boundsByViewId.get(sourceId);
    if (!sourceBounds) return undefined;

    const sourceRight = sourceBounds.x + sourceBounds.width;
    const sourceBottom = sourceBounds.y + sourceBounds.height;
    const candidates: Array<{
      view: ViewInfo;
      distance: number;
      overlap: number;
    }> = [];

    for (const view of visibleViews) {
      if (view.id === sourceId) continue;
      const bounds = boundsByViewId.get(view.id);
      if (!bounds) continue;

      const right = bounds.x + bounds.width;
      const bottom = bounds.y + bounds.height;
      const horizontalOverlap =
        Math.min(sourceRight, right) - Math.max(sourceBounds.x, bounds.x);
      const verticalOverlap =
        Math.min(sourceBottom, bottom) - Math.max(sourceBounds.y, bounds.y);

      switch (direction) {
        case "left":
          if (right <= sourceBounds.x && verticalOverlap > 0) {
            candidates.push({
              view,
              distance: sourceBounds.x - right,
              overlap: verticalOverlap,
            });
          }
          break;
        case "right":
          if (bounds.x >= sourceRight && verticalOverlap > 0) {
            candidates.push({
              view,
              distance: bounds.x - sourceRight,
              overlap: verticalOverlap,
            });
          }
          break;
        case "top":
          if (bottom <= sourceBounds.y && horizontalOverlap > 0) {
            candidates.push({
              view,
              distance: sourceBounds.y - bottom,
              overlap: horizontalOverlap,
            });
          }
          break;
        case "bottom":
          if (bounds.y >= sourceBottom && horizontalOverlap > 0) {
            candidates.push({
              view,
              distance: bounds.y - sourceBottom,
              overlap: horizontalOverlap,
            });
          }
          break;
      }
    }

    return candidates.sort(
      (a, b) =>
        a.distance - b.distance ||
        b.overlap - a.overlap ||
        a.view.id - b.view.id,
    )[0]?.view;
  }

  function canCoverNeighbor(
    source: ViewInfo,
    neighbor: ViewInfo,
    direction: TileLayoutDirection,
    boundsByViewId: Map<number, Bounds>,
  ): boolean {
    const sourceBounds = boundsByViewId.get(source.id);
    const neighborBounds = boundsByViewId.get(neighbor.id);
    if (!sourceBounds || !neighborBounds) return false;

    const sameHorizontalBand =
      Math.abs(sourceBounds.y - neighborBounds.y) <= 1 &&
      Math.abs(sourceBounds.height - neighborBounds.height) <= 1;
    const sameVerticalBand =
      Math.abs(sourceBounds.x - neighborBounds.x) <= 1 &&
      Math.abs(sourceBounds.width - neighborBounds.width) <= 1;
    const sharesBand =
      direction === "left" || direction === "right"
        ? sameHorizontalBand
        : sameVerticalBand;

    if (!sharesBand) return false;

    const combinedBounds = combineBounds(sourceBounds, neighborBounds);
    const constrainedBounds = constrainTiledBounds(combinedBounds, source);
    return (
      Math.abs(constrainedBounds.width - combinedBounds.width) <= 1 &&
      Math.abs(constrainedBounds.height - combinedBounds.height) <= 1
    );
  }

  function combineBounds(first: Bounds, second: Bounds): Bounds {
    const x = Math.min(first.x, second.x);
    const y = Math.min(first.y, second.y);
    const right = Math.max(first.x + first.width, second.x + second.width);
    const bottom = Math.max(first.y + first.height, second.y + second.height);
    return { x, y, width: right - x, height: bottom - y };
  }

  function isExpansionParticipant(viewId: number): boolean {
    if (_expandedTiles.has(viewId)) return true;
    return Array.from(_expandedTiles.values()).includes(viewId);
  }

  function findDirectionToView(
    sourceId: number,
    targetId: number,
    visibleViews: ViewInfo[],
    boundsByViewId: Map<number, Bounds>,
  ): TileLayoutDirection | undefined {
    const directions: TileLayoutDirection[] = [
      "top",
      "right",
      "bottom",
      "left",
    ];
    return directions.find(
      (direction) =>
        getNeighbor(sourceId, direction, visibleViews, boundsByViewId)?.id ===
        targetId,
    );
  }

  function getTileLayoutState(
    viewId: number,
    views: ReadonlyMap<number, ViewInfo>,
  ): TileLayoutState {
    const source = views.get(viewId);
    if (!source || !isEnabled() || source.mode !== "tiled" || !source.visible) {
      return {
        mode: source?.mode ?? "floating",
        neighbors: {},
      };
    }

    if (isExpansionParticipant(source.id)) {
      return { mode: "tiled", neighbors: {} };
    }

    const { visibleViews, boundsByViewId } = getBaseLayout(views);
    const directions: TileLayoutDirection[] = [
      "top",
      "right",
      "bottom",
      "left",
    ];
    const neighbors: TileLayoutState["neighbors"] = {};

    for (const direction of directions) {
      const neighbor = getNeighbor(
        source.id,
        direction,
        visibleViews,
        boundsByViewId,
      );
      if (!neighbor || isExpansionParticipant(neighbor.id)) continue;
      neighbors[direction] = {
        name: neighbor.manifest.name,
        canExpand: canCoverNeighbor(
          source,
          neighbor,
          direction,
          boundsByViewId,
        ),
      };
    }

    return {
      mode: "tiled",
      neighbors,
    };
  }

  function swapTile(
    viewId: number,
    direction: TileLayoutDirection,
    views: ReadonlyMap<number, ViewInfo>,
  ): boolean {
    const source = views.get(viewId);
    if (
      source?.mode !== "tiled" ||
      !source.visible ||
      isExpansionParticipant(viewId)
    ) {
      return false;
    }

    const { visibleViews, boundsByViewId } = getBaseLayout(views);
    const neighbor = getNeighbor(
      source.id,
      direction,
      visibleViews,
      boundsByViewId,
    );
    if (!neighbor || isExpansionParticipant(neighbor.id)) return false;

    const sourceIndex = source.tileIndex;
    source.tileIndex = neighbor.tileIndex;
    neighbor.tileIndex = sourceIndex;
    return true;
  }

  function expandTile(
    viewId: number,
    direction: TileLayoutDirection,
    views: ReadonlyMap<number, ViewInfo>,
  ): boolean {
    const source = views.get(viewId);
    if (
      source?.mode !== "tiled" ||
      !source.visible ||
      isExpansionParticipant(viewId)
    ) {
      return false;
    }

    const { visibleViews, boundsByViewId } = getBaseLayout(views);
    const neighbor = getNeighbor(
      source.id,
      direction,
      visibleViews,
      boundsByViewId,
    );
    if (
      !neighbor ||
      isExpansionParticipant(neighbor.id) ||
      !canCoverNeighbor(source, neighbor, direction, boundsByViewId)
    ) {
      return false;
    }

    _expandedTiles.set(source.id, neighbor.id);
    return true;
  }

  function restoreExpansionForView(viewId: number): boolean {
    let restored = _expandedTiles.delete(viewId);
    for (const [sourceId, targetId] of _expandedTiles) {
      if (targetId !== viewId) continue;
      _expandedTiles.delete(sourceId);
      restored = true;
    }
    return restored;
  }

  function canFitVisibleSet(visibleViews: ViewInfo[]): boolean {
    if (!isEnabled()) return true;

    if (visibleViews.length === 0) {
      return true;
    }

    const capacity = getTiledCapacity();
    if (capacity !== undefined && visibleViews.length > capacity) {
      return false;
    }

    const boundsByViewId = calculateVisibleSetBounds(visibleViews);

    return visibleViews.every((view) => {
      const bounds = boundsByViewId.get(view.id);
      if (!bounds) {
        return false;
      }

      const scale = scaleForView(view);
      const minWidth = Math.round(
        (view.manifest.window?.minSize?.width ?? 0) * scale,
      );
      const minHeight = Math.round(
        (view.manifest.window?.minSize?.height ?? 0) * scale,
      );

      return bounds.width >= minWidth && bounds.height >= minHeight;
    });
  }

  function constrainTiledBounds(bounds: Bounds, view: ViewInfo): Bounds {
    const scale = scaleForView(view);
    const configuredMaxWidth = view.manifest.window?.maxSize?.width;
    const configuredMaxHeight = view.manifest.window?.maxSize?.height;
    const maxWidth =
      configuredMaxWidth === undefined
        ? undefined
        : Math.round(configuredMaxWidth * scale);
    const maxHeight =
      configuredMaxHeight === undefined
        ? undefined
        : Math.round(configuredMaxHeight * scale);

    const width =
      typeof maxWidth === "number" && maxWidth > 0
        ? Math.min(bounds.width, maxWidth)
        : bounds.width;
    const height =
      typeof maxHeight === "number" && maxHeight > 0
        ? Math.min(bounds.height, maxHeight)
        : bounds.height;

    if (width === bounds.width && height === bounds.height) {
      return bounds;
    }

    return {
      x: bounds.x + (bounds.width - width) / 2,
      y: bounds.y + (bounds.height - height) / 2,
      width,
      height,
    };
  }

  function getTiledCapacity(): number | undefined {
    if (!isEnabled()) return undefined;

    const { mode, columns, rows } = _config;

    switch (mode) {
      case "grid": {
        const safeColumns = normalizeCount(columns, 2);
        const safeRows = normalizeCount(rows, 2);
        return safeColumns * safeRows;
      }
      case "smart":
        return getSmartTilingCapacity(_workspaceBounds, _config);
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

  function resolveTiledVisibilityChanges(
    views: ReadonlyMap<number, ViewInfo>,
    options: {
      preferredViewId?: number;
      excludedViewId?: number;
    } = {},
  ): { toHide: number[]; toShow: number[] } {
    if (!isEnabled()) return { toHide: [], toShow: [] };

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
    const tiledAppById = new Map(tiledApps.map((view) => [view.id, view]));

    const desiredVisibleIds = new Set(
      requestedTiledApps.filter((view) => view.visible).map((view) => view.id),
    );

    const canFitDesiredSet = (): boolean =>
      canFitVisibleSet(
        Array.from(desiredVisibleIds)
          .map((viewId) => tiledAppById.get(viewId))
          .filter((view): view is ViewInfo => view !== undefined),
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
      desiredVisibleIds.add(preferredViewId);
      while (!canFitDesiredSet() && popOldestVisible()) {
        // Make room for the preferred tiled view before adding it back.
      }
    }

    while (!canFitDesiredSet() && popOldestVisible()) {
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
      desiredVisibleIds.add(candidate.id);
      if (!canFitDesiredSet()) {
        desiredVisibleIds.delete(candidate.id);
      }
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

  function calculateTileBounds(
    tileIndex: number,
    visibleCount: number,
    views: Iterable<ViewInfo> = [],
  ): Bounds {
    return calculateLayoutTileBounds({
      workspace: _workspaceBounds,
      tileIndex,
      visibleCount,
      config: getEffectiveConfig(views),
    });
  }

  function getNextTileIndex(views: Iterable<ViewInfo>): number {
    const indices: number[] = [];

    for (const view of views) {
      if (
        view.visible &&
        view.mode === "tiled" &&
        view.tileIndex !== undefined
      ) {
        indices.push(view.tileIndex);
      }
    }

    if (indices.length === 0) return 0;
    return Math.max(...indices) + 1;
  }

  function getVisibleTiledCount(views: Iterable<ViewInfo>): number {
    return Array.from(views).filter((v) => v.visible && v.mode === "tiled")
      .length;
  }

  function recalculateTiledViews(views: ReadonlyMap<number, ViewInfo>): void {
    if (!isEnabled()) return;

    const { visibleViews, boundsByViewId } = getBaseLayout(views);
    const presentedBoundsByViewId = new Map(boundsByViewId);

    for (const [sourceId, targetId] of _expandedTiles) {
      const source = views.get(sourceId);
      const target = views.get(targetId);
      const direction = findDirectionToView(
        sourceId,
        targetId,
        visibleViews,
        boundsByViewId,
      );
      if (
        !source ||
        !target ||
        !direction ||
        !canCoverNeighbor(source, target, direction, boundsByViewId)
      ) {
        _expandedTiles.delete(sourceId);
        continue;
      }

      const sourceBounds = boundsByViewId.get(sourceId);
      const targetBounds = boundsByViewId.get(targetId);
      if (!sourceBounds || !targetBounds) continue;
      presentedBoundsByViewId.set(
        sourceId,
        combineBounds(sourceBounds, targetBounds),
      );
      presentedBoundsByViewId.set(targetId, {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      });
    }

    visibleViews.forEach((info, index) => {
      const bounds = presentedBoundsByViewId.get(info.id);
      if (!bounds) {
        return;
      }

      info.tileIndex = index;
      info.bounds = bounds;

      // Only set bounds if view is not destroyed
      if (!info.view.webContents.isDestroyed()) {
        info.view.setBounds(bounds);
      }
    });
  }

  function determineViewMode(windowConfig?: WindowConfig): ViewMode {
    const windowMode = windowConfig?.mode;

    // If no window config mode specified
    if (!windowMode) {
      return isEnabled() ? "tiled" : "floating";
    }

    // Check what the app supports
    switch (windowMode) {
      case "floating":
        return "floating";
      case "tiled":
        return "tiled";
      case "both":
        if (windowConfig.defaultMode) {
          return windowConfig.defaultMode;
        }

        // If app supports both, prefer tiled if tiling is enabled
        return isEnabled() ? "tiled" : "floating";
      default:
        return isEnabled() ? "tiled" : "floating";
    }
  }
  return {
    setWorkspaceBounds,
    getWorkspaceBounds,
    setConfig,
    getConfig,
    isEnabled,
    getTileLayoutState,
    swapTile,
    expandTile,
    restoreExpansionForView,
    getTiledCapacity,
    resolveTiledVisibilityChanges,
    calculateTileBounds,
    getNextTileIndex,
    getVisibleTiledCount,
    recalculateTiledViews,
    determineViewMode,
  };
}

export type Tiling = ReturnType<typeof createTiling>;

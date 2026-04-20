import type { TilingConfig, TilingMode } from "@edenapp/types";
import type { Rectangle as Bounds } from "electron";

/**
 * Grid dimensions for a layout
 */
interface GridDimensions {
  rows: number;
  columns: number;
}

/**
 * Layout calculation parameters
 */
interface LayoutParams {
  workspace: Bounds;
  tileIndex: number;
  visibleCount: number;
  config: TilingConfig;
}

/**
 * Calculate bounds for a tile at a given index.
 */
export function calculateTileBounds(params: LayoutParams): Bounds {
  const { workspace, tileIndex, visibleCount, config } = params;
  const {
    mode,
    gap = 0,
    padding = 0,
    columns = 2,
    rows = 2,
    minTileWidth = 600,
    minTileHeight = 400,
  } = config;

  // Apply padding to workspace
  const available = applyPadding(workspace, padding);

  // No tiling or no visible items
  if (mode === "none" || visibleCount === 0) {
    return available;
  }

  // Calculate grid dimensions based on mode
  const grid = getGridDimensions({
    mode,
    available,
    visibleCount,
    configRows: rows,
    configColumns: columns,
    gap,
    minTileWidth,
    minTileHeight,
  });

  // Calculate tile bounds in grid
  return calculateGridCell(
    available,
    tileIndex,
    visibleCount,
    grid,
    gap,
    getTargetAspectRatio(minTileWidth, minTileHeight),
  );
}

/**
 * Compute the maximum number of smart-tiled views that can fit while
 * still respecting the configured minimum tile width and height.
 */
export function getSmartTilingCapacity(
  workspace: Bounds,
  config: Pick<
    TilingConfig,
    "gap" | "padding" | "minTileWidth" | "minTileHeight"
  >,
): number {
  const {
    gap = 0,
    padding = 0,
    minTileWidth = 600,
    minTileHeight = 400,
  } = config;
  const available = applyPadding(workspace, padding);
  const safeMinTileWidth = Math.max(1, minTileWidth);
  const safeMinTileHeight = Math.max(1, minTileHeight);
  const maxColumns = Math.max(
    1,
    Math.floor((available.width + gap) / (safeMinTileWidth + gap)),
  );
  const maxRows = Math.max(
    1,
    Math.floor((available.height + gap) / (safeMinTileHeight + gap)),
  );

  let bestCapacity = 1;

  for (
    let visibleCount = 2;
    visibleCount <= maxColumns * maxRows;
    visibleCount += 1
  ) {
    if (
      canFitSmartTileCount({
        available,
        visibleCount,
        gap,
        minTileWidth: safeMinTileWidth,
        minTileHeight: safeMinTileHeight,
      })
    ) {
      bestCapacity = visibleCount;
    }
  }

  return bestCapacity;
}

/**
 * Apply padding to bounds.
 */
function applyPadding(bounds: Bounds, padding: number): Bounds {
  return {
    x: bounds.x + padding,
    y: bounds.y + padding,
    width: bounds.width - padding * 2,
    height: bounds.height - padding * 2,
  };
}

/**
 * Determine grid dimensions based on tiling mode.
 */
function getGridDimensions(params: {
  mode: TilingMode;
  available: Bounds;
  visibleCount: number;
  configRows: number;
  configColumns: number;
  gap: number;
  minTileWidth: number;
  minTileHeight: number;
}): GridDimensions {
  const {
    mode,
    available,
    visibleCount,
    configRows,
    configColumns,
    gap,
    minTileWidth,
    minTileHeight,
  } = params;

  switch (mode) {
    case "horizontal":
      // Horizontal = 1 row × N columns
      return { rows: 1, columns: visibleCount };

    case "vertical":
      // Vertical = N rows × 1 column
      return { rows: visibleCount, columns: 1 };

    case "grid":
      // Use configured dimensions
      return { rows: configRows, columns: configColumns };

    case "smart":
      return getSmartGridDimensions({
        available,
        visibleCount,
        gap,
        minTileWidth,
        minTileHeight,
      });

    default:
      return { rows: 1, columns: 1 };
  }
}

/**
 * Choose the smart grid dimensions that best satisfy the minimum tile
 * constraints, with a balanced fallback when no layout fully fits.
 */
function getSmartGridDimensions(params: {
  available: Bounds;
  visibleCount: number;
  gap: number;
  minTileWidth: number;
  minTileHeight: number;
}): GridDimensions {
  const { available, visibleCount, gap, minTileWidth, minTileHeight } = params;

  let bestFeasible: GridDimensions | null = null;
  let bestFeasibleEmptyCells = Number.POSITIVE_INFINITY;
  let bestFeasibleAspectScore = Number.POSITIVE_INFINITY;
  let bestFallback: GridDimensions = { rows: visibleCount, columns: 1 };
  let bestFallbackScore = Number.NEGATIVE_INFINITY;
  const targetAspectRatio = getTargetAspectRatio(minTileWidth, minTileHeight);

  for (let columns = 1; columns <= visibleCount; columns += 1) {
    const rows = Math.ceil(visibleCount / columns);
    const tileWidth = calculateTrackSize(available.width, columns, gap);
    const tileHeight = calculateTrackSize(available.height, rows, gap);

    const widthRatio =
      minTileWidth > 0 ? tileWidth / minTileWidth : Number.POSITIVE_INFINITY;
    const heightRatio =
      minTileHeight > 0 ? tileHeight / minTileHeight : Number.POSITIVE_INFINITY;

    if (widthRatio >= 1 && heightRatio >= 1) {
      const emptyCells = rows * columns - visibleCount;
      const aspectScore = Math.abs(
        Math.log(tileWidth / tileHeight / targetAspectRatio),
      );

      if (
        emptyCells < bestFeasibleEmptyCells ||
        (emptyCells === bestFeasibleEmptyCells &&
          aspectScore < bestFeasibleAspectScore)
      ) {
        bestFeasible = { rows, columns };
        bestFeasibleEmptyCells = emptyCells;
        bestFeasibleAspectScore = aspectScore;
      }
      continue;
    }

    const score = Math.min(widthRatio, heightRatio);
    if (
      score > bestFallbackScore ||
      (score === bestFallbackScore && columns > bestFallback.columns)
    ) {
      bestFallback = { rows, columns };
      bestFallbackScore = score;
    }
  }

  return bestFeasible ?? bestFallback;
}

/**
 * Calculate bounds for a specific tile in a partially filled grid.
 *
 * When the grid has unused cells, the layout compares two compaction strategies:
 * row-compacted stretches partially filled rows horizontally, and
 * column-compacted stretches partially filled columns vertically.
 * The variant whose tile shapes are closest to the target aspect ratio wins.
 */
function calculateGridCell(
  available: Bounds,
  index: number,
  visibleCount: number,
  grid: GridDimensions,
  gap: number,
  targetAspectRatio: number,
): Bounds {
  const rowLayout = calculateRowCompactedCell(
    available,
    index,
    visibleCount,
    grid,
    gap,
  );
  const columnLayout = calculateColumnCompactedCell(
    available,
    index,
    visibleCount,
    grid,
    gap,
  );

  const rowScore = scoreLayoutAgainstAspectRatio(
    available,
    visibleCount,
    grid,
    gap,
    targetAspectRatio,
    "row",
  );
  const columnScore = scoreLayoutAgainstAspectRatio(
    available,
    visibleCount,
    grid,
    gap,
    targetAspectRatio,
    "column",
  );

  return rowScore <= columnScore ? rowLayout : columnLayout;
}

function calculateTrackSize(
  totalSize: number,
  trackCount: number,
  gap: number,
): number {
  return (totalSize - gap * (trackCount - 1)) / trackCount;
}

function canFitSmartTileCount(params: {
  available: Bounds;
  visibleCount: number;
  gap: number;
  minTileWidth: number;
  minTileHeight: number;
}): boolean {
  const { available, visibleCount, gap, minTileWidth, minTileHeight } = params;

  for (let columns = 1; columns <= visibleCount; columns += 1) {
    const rows = Math.ceil(visibleCount / columns);
    const tileWidth = calculateTrackSize(available.width, columns, gap);
    const tileHeight = calculateTrackSize(available.height, rows, gap);

    if (tileWidth >= minTileWidth && tileHeight >= minTileHeight) {
      return true;
    }
  }

  return false;
}

function getTargetAspectRatio(
  minTileWidth: number,
  minTileHeight: number,
): number {
  if (minTileWidth > 0 && minTileHeight > 0) {
    return minTileWidth / minTileHeight;
  }

  return 1;
}

/**
 * Compact a partially filled grid by row, stretching incomplete rows
 * horizontally while keeping the occupied row count fixed.
 */
function calculateRowCompactedCell(
  available: Bounds,
  index: number,
  visibleCount: number,
  grid: GridDimensions,
  gap: number,
): Bounds {
  const occupiedRows = Math.max(
    1,
    Math.min(grid.rows, Math.ceil(visibleCount / grid.columns)),
  );
  const row = Math.floor(index / grid.columns);
  const itemsBeforeRow = row * grid.columns;
  const itemsInRow = Math.max(
    1,
    Math.min(grid.columns, visibleCount - itemsBeforeRow),
  );
  const col = index - itemsBeforeRow;
  const tileWidth = calculateTrackSize(available.width, itemsInRow, gap);
  const tileHeight = calculateTrackSize(available.height, occupiedRows, gap);

  return {
    x: available.x + col * (tileWidth + gap),
    y: available.y + row * (tileHeight + gap),
    width: tileWidth,
    height: tileHeight,
  };
}

/**
 * Compact a partially filled grid by column, stretching incomplete columns
 * vertically while keeping the occupied column count fixed.
 */
function calculateColumnCompactedCell(
  available: Bounds,
  index: number,
  visibleCount: number,
  grid: GridDimensions,
  gap: number,
): Bounds {
  const occupiedColumns = Math.max(
    1,
    Math.min(grid.columns, Math.ceil(visibleCount / grid.rows)),
  );
  const col = Math.floor(index / grid.rows);
  const itemsBeforeColumn = col * grid.rows;
  const itemsInColumn = Math.max(
    1,
    Math.min(grid.rows, visibleCount - itemsBeforeColumn),
  );
  const row = index - itemsBeforeColumn;
  const tileWidth = calculateTrackSize(available.width, occupiedColumns, gap);
  const tileHeight = calculateTrackSize(available.height, itemsInColumn, gap);

  return {
    x: available.x + col * (tileWidth + gap),
    y: available.y + row * (tileHeight + gap),
    width: tileWidth,
    height: tileHeight,
  };
}

/**
 * Score a candidate compacted layout by summing each tile's aspect-ratio
 * distance from the target ratio. Lower scores are better.
 */
function scoreLayoutAgainstAspectRatio(
  available: Bounds,
  visibleCount: number,
  grid: GridDimensions,
  gap: number,
  targetAspectRatio: number,
  strategy: "row" | "column",
): number {
  let score = 0;

  for (let index = 0; index < visibleCount; index += 1) {
    const bounds =
      strategy === "row"
        ? calculateRowCompactedCell(available, index, visibleCount, grid, gap)
        : calculateColumnCompactedCell(
            available,
            index,
            visibleCount,
            grid,
            gap,
          );
    const aspectRatio = bounds.width / bounds.height;
    score += Math.abs(Math.log(aspectRatio / targetAspectRatio));
  }

  return score;
}

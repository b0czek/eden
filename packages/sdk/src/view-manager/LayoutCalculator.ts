import { Rectangle as Bounds } from "electron";
import { TilingConfig, TilingMode } from "@edenapp/types";

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
 * LayoutCalculator
 *
 * Generic utility for calculating tile bounds in various layout modes.
 * Provides a pluggable system for different tiling strategies.
 */
export class LayoutCalculator {
  /**
   * Calculate bounds for a tile at a given index
   */
  static calculateTileBounds(params: LayoutParams): Bounds {
    const { workspace, tileIndex, visibleCount, config } = params;
    const { mode, gap = 0, padding = 0, columns = 2, rows = 2 } = config;

    // Apply padding to workspace
    const available = this.applyPadding(workspace, padding);

    // No tiling or no visible items
    if (mode === "none" || visibleCount === 0) {
      return available;
    }

    // Calculate grid dimensions based on mode
    const grid = this.getGridDimensions(mode, visibleCount, rows, columns);

    // Calculate tile bounds in grid
    return this.calculateGridCell(available, tileIndex, grid, gap);
  }

  /**
   * Apply padding to bounds
   */
  private static applyPadding(bounds: Bounds, padding: number): Bounds {
    return {
      x: bounds.x + padding,
      y: bounds.y + padding,
      width: bounds.width - padding * 2,
      height: bounds.height - padding * 2,
    };
  }

  /**
   * Determine grid dimensions based on tiling mode
   */
  private static getGridDimensions(
    mode: TilingMode,
    visibleCount: number,
    configRows: number,
    configColumns: number,
  ): GridDimensions {
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

      default:
        return { rows: 1, columns: 1 };
    }
  }

  /**
   * Calculate bounds for a specific cell in a grid
   */
  private static calculateGridCell(
    available: Bounds,
    index: number,
    grid: GridDimensions,
    gap: number,
  ): Bounds {
    const col = index % grid.columns;
    const row = Math.floor(index / grid.columns);

    const tileWidth =
      (available.width - gap * (grid.columns - 1)) / grid.columns;
    const tileHeight = (available.height - gap * (grid.rows - 1)) / grid.rows;

    return {
      x: available.x + col * (tileWidth + gap),
      y: available.y + row * (tileHeight + gap),
      width: tileWidth,
      height: tileHeight,
    };
  }
}

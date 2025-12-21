/**
 * Tiling Configuration
 *
 * Defines how the workspace should be divided for apps
 */
export type TilingMode = "none" | "horizontal" | "vertical" | "grid";

export interface TilingConfig {
  /** Tiling mode */
  mode: TilingMode;

  /** Number of columns (for grid mode) */
  columns?: number;

  /** Number of rows (for grid mode) */
  rows?: number;

  /** Gap between tiles in pixels */
  gap?: number;

  /** Padding around the workspace in pixels */
  padding?: number;
}

export interface EdenConfig {
  appsDirectory?: string;
  userDirectory?: string;
  window?: {
    width?: number;
    height?: number;
    title?: string;
    backgroundColor?: string;
  };
  tiling?: TilingConfig;
  development?: boolean;

  /** List of app IDs to start automatically when Eden launches */
  autostart?: string[];
}

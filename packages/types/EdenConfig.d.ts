/**
 * Tiling Configuration
 *
 * Defines how the workspace should be divided for apps
 */
export type TilingMode = "none" | "horizontal" | "vertical" | "grid" | "smart";

export interface TilingConfig {
  /**
   * Tiling mode.
   * - "grid" uses the configured row/column count.
   * - "smart" derives the grid from minimum tile constraints.
   *
   * When a grid is only partially filled, Eden may compact the layout either
   * by row or by column and chooses the variant whose tile shapes best match
   * the configured target aspect ratio.
   */
  mode: TilingMode;

  /** Number of columns for fixed grid mode. */
  columns?: number;

  /** Number of rows for fixed grid mode. */
  rows?: number;

  /**
   * Minimum tile width in pixels for smart mode.
   * Also contributes to the target aspect ratio used when a grid has empty cells.
   */
  minTileWidth?: number;

  /**
   * Minimum tile height in pixels for smart mode.
   * Also contributes to the target aspect ratio used when a grid has empty cells.
   */
  minTileHeight?: number;

  /** Gap between tiles in pixels */
  gap?: number;

  /** Padding around the workspace in pixels */
  padding?: number;
}

/**
 * Consumer-controlled product branding.
 *
 * Relative asset paths resolve from Electron's application directory.
 */
export interface EdenBrandingConfig {
  /** Product name shown by SDK-owned user interfaces. */
  name: string;

  /** Logo shown by SDK-owned user interfaces. */
  logoPath?: string;

  /** Icon used for the main Electron window. */
  iconPath?: string;
}

export interface EdenConfig {
  appsDirectory?: string;
  userDirectory?: string;
  branding?: EdenBrandingConfig;
  window?: {
    width?: number;
    height?: number;
    minWidth?: number;
    minHeight?: number;
    title?: string;
    backgroundColor?: string;
  };
  tiling?: TilingConfig;
  development?: boolean;
  hotReload?: {
    /**
     * Enable frontend hot reload support in development.
     * Defaults to true when development is true, otherwise false.
     */
    enabled?: boolean;

    /** Debounce delay for reacting to dev server state changes. */
    debounce?: number;

    /**
     * Directory containing enabled.json and servers.json.
     * Relative paths resolve from the process working directory.
     */
    stateDirectory?: string;
  };

  /** App ID used for login UI when no user is active */
  loginAppId?: string;

  /** Apps allowed to launch regardless of user grants */
  coreApps?: string[];

  /** Apps blocked from launch for non-vendor users */
  restrictedApps?: string[];
}

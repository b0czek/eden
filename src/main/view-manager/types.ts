import { Rectangle as Bounds, WebContentsView } from "electron";
import { AppManifest } from "../../types";

export type ViewMode = "floating" | "tiled";
export type ViewType = "app" | "overlay";

// Z-layer constants for view ordering
export const Z_LAYERS = {
  APPS_MIN: 1,
  APPS_MAX: 999,
  OVERLAY_MIN: 1000,
  OVERLAY_MAX: 9999,
} as const;

export interface ViewInfo {
  view: WebContentsView;
  appId: string;
  manifest: AppManifest;
  bounds: Bounds;
  visible: boolean;
  mode: ViewMode;
  viewType: ViewType; // Type of view: app or overlay
  tileIndex?: number; // Only for tiled app views
  zIndex?: number; // For floating apps and all overlays
}

/**
 * Options for creating a view
 */
export interface CreateViewOptions {
  appId: string;
  manifest: AppManifest;
  installPath: string;
  preloadScript: string;
  viewType: ViewType;
  viewMode: ViewMode;
  viewBounds: Bounds;
  tileIndex?: number;
  zIndex?: number;
}

import type { AppManifest } from "@edenapp/types";
import type { Rectangle as Bounds, WebContentsView } from "electron";

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
  id: number;
  view: WebContentsView;
  appId: string;
  manifest: AppManifest;
  bounds: Bounds;
  /**
   * Whether the user currently wants this view shown.
   * Capacity-based tiling may still keep it off-screen temporarily.
   */
  requestedVisible: boolean;
  /**
   * Whether the view is currently displayed on-screen.
   * This may be false either because the user hid it or because tiling
   * temporarily removed it to satisfy layout capacity.
   */
  visible: boolean;
  mode: ViewMode;
  viewType: ViewType; // Type of view: app or overlay
  tileIndex?: number; // Only for tiled app views
  zIndex?: number; // For floating apps and all overlays
  launchArgs?: string[]; // Arguments passed when launching this view
  lastFocusedAt?: number; // Timestamp used for LRU-style view selection
}

export interface ViewCreationOptions {
  preloadScript: string;
  transparent?: boolean;
  backgroundThrottling?: boolean;
  additionalArguments?: string[];
}

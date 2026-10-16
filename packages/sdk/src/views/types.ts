import type { AppManifest } from "@edenapp/types";
import type { Bounds, PlatformView } from "../platform/ports";

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
  view: PlatformView;
  appId: string;
  manifest: AppManifest;
  bounds: Bounds;
  /**
   * Whether the user currently wants this view shown.
   * Capacity-based tiling may still keep it off-screen temporarily.
   */
  requestedVisible: boolean;
  /**
   * Whether the view participates in the active presentation.
   * This may be false either because the user hid it or because tiling
   * temporarily removed it to satisfy layout capacity. A transient tile
   * expansion may cover a participating view with zero bounds without
   * changing this flag, which preserves the underlying layout for restore.
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

/**
 * Compare overlays from bottom to top.
 * Manifest priority defines the stack group; z-index controls recency within it.
 */
export function compareOverlayViews(a: ViewInfo, b: ViewInfo): number {
  const priorityDifference =
    (a.manifest.window?.overlayPriority ?? 0) -
    (b.manifest.window?.overlayPriority ?? 0);
  if (priorityDifference !== 0) return priorityDifference;

  const zIndexDifference = (a.zIndex ?? 0) - (b.zIndex ?? 0);
  if (zIndexDifference !== 0) return zIndexDifference;

  return a.id - b.id;
}

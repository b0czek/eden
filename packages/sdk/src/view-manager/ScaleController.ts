/**
 * ScaleController
 *
 * Handles interface scaling (zoom) for views.
 * Extracted from ViewManager to reduce complexity.
 */

import type { AppManifest } from "@edenapp/types";
import type { IPCBridge } from "../ipc";
import { log } from "../logging";
import {
  EDEN_SETTINGS_APP_ID,
  type SettingsManager,
} from "../settings/SettingsManager";
import type { ViewInfo, ViewType } from "./types";

const INTERFACE_SCALE_KEY = "general.interfaceScale";

export class ScaleController {
  private currentScale: number = 1.0;
  private readonly getViews: () => Iterable<ViewInfo>;
  private readonly settingsManager: SettingsManager;

  constructor(
    settingsManager: SettingsManager,
    getViews: () => Iterable<ViewInfo>,
    ipcBridge: IPCBridge,
  ) {
    this.settingsManager = settingsManager;
    this.getViews = getViews;

    // Listen for interface scale setting changes
    ipcBridge.eventSubscribers.subscribeInternal("settings/changed", (data) => {
      if (data.key === INTERFACE_SCALE_KEY) {
        const scale = parseFloat(data.value);
        if (!Number.isNaN(scale)) {
          this.setScale(scale);
        }
      }
    });

    // Initialize scale on next tick (after construction completes)
    this.initialize();
  }

  /**
   * Get the current interface scale
   */
  getScale(): number {
    return this.currentScale;
  }

  /**
   * Initialize interface scale from settings
   */
  private async initialize(): Promise<void> {
    try {
      const scaleSetting = await this.settingsManager.get(
        EDEN_SETTINGS_APP_ID,
        INTERFACE_SCALE_KEY,
      );

      if (scaleSetting) {
        const scale = parseFloat(scaleSetting);
        if (!Number.isNaN(scale) && scale >= 0.5 && scale <= 2.0) {
          this.currentScale = scale;
          log.info(`Initialized interface scale to ${scale * 100}%`);
        }
      }
    } catch (error) {
      log.error("Failed to initialize interface scale:", error);
    }
  }

  /**
   * Set the interface scale and apply to all views
   * @param scale - Zoom factor (e.g., 1.0 = 100%, 1.5 = 150%)
   */
  setScale(scale: number): void {
    if (scale < 0.5 || scale > 2.0) {
      throw new Error(`Invalid scale ${scale}. Must be between 0.5 and 2.0`);
    }

    this.currentScale = scale;
    log.info(`Setting interface scale to ${scale * 100}%`);

    for (const viewInfo of this.getViews()) {
      this.applyToView(viewInfo);
    }
  }

  /**
   * Apply the current zoom factor to a single view
   * Respects the manifest's window.scaling setting:
   * - "auto": SDK applies interface scale (default for regular apps)
   * - "manual": SDK doesn't apply scaling (default for overlays)
   */
  applyToView(viewInfo: ViewInfo): void {
    try {
      if (viewInfo.view.webContents.isDestroyed()) {
        return;
      }

      const scalingMode = this.getScalingMode(
        viewInfo.manifest,
        viewInfo.viewType,
      );

      if (scalingMode === "manual") {
        return;
      }

      viewInfo.view.webContents.setZoomFactor(this.currentScale);
    } catch (error) {
      log.error(`Failed to set zoom for view ${viewInfo.id}:`, error);
    }
  }

  /**
   * Determine the scaling mode for a view based on manifest and view type
   */
  private getScalingMode(
    manifest: AppManifest,
    viewType: ViewType,
  ): "auto" | "manual" {
    return (
      manifest.window?.scaling ?? (viewType === "overlay" ? "manual" : "auto")
    );
  }
}

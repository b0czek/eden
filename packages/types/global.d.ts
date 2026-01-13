// Ambient declarations for renderer globals

import type { EdenAPI, AppBusAPI, AppBusConnection } from "./ipc";

export interface EdenFrame {
  // Public API
  setTitle: (title: string) => void;
  resetTitle: () => void;

  // Internal state (used by frame system)
  _internal: {
    appId: string;
    appName: string | Record<string, string>;
    injected: boolean;
    config: {
      mode?: "tiled" | "floating" | "both";
      showTitle?: boolean;
      defaultSize?: { width: number; height: number };
      defaultPosition?: { x: number; y: number };
      movable?: boolean;
      resizable?: boolean;
      minSize?: { width: number; height: number };
      maxSize?: { width: number; height: number };
    };
    currentMode: "tiled" | "floating";
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}

declare global {
  interface Window {
    /**
     * Eden API instance available in renderer processes
     */
    edenAPI: EdenAPI;

    /**
     * AppBus instance for app-to-app communication
     */
    appBus: AppBusAPI;

    /**
     * Get AppAPI for frontend<->backend communication
     * Throws if connection is not available
     */
    getAppAPI: () => AppBusConnection;

    edenFrame?: EdenFrame;
  }
}

// This export is important - it marks the file as a module
export {};

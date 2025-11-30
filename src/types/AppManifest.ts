/**
 * Window Mode Configuration
 *
 * Defines how an app's window can be displayed
 */
export type WindowMode = "floating" | "tiled" | "both";

export interface WindowInjectionOptions {
  /** Inject the Eden design system CSS into the view (default: true) */
  css?: boolean;

  /** Inject the Eden app frame with title bar controls (default: true) */
  appFrame?: boolean;
}

export interface WindowConfig {
  /** Window display modes supported by the app */
  mode: WindowMode;

  /** Default window size for floating mode */
  defaultSize?: {
    width: number;
    height: number;
  };

  /** Default window position for floating mode (if not specified, will be centered) */
  defaultPosition?: {
    x: number;
    y: number;
  };

  /** Minimum window size */
  minSize?: {
    width: number;
    height: number;
  };

  /** Maximum window size */
  maxSize?: {
    width: number;
    height: number;
  };

  /** Whether the window can be resized (default: true for floating, false for tiled) */
  resizable?: boolean;

  /** Whether the window can be moved (default: true for floating, false for tiled) */
  movable?: boolean;

  /** Whether to show the title in the title bar (default: true) */
  showTitle?: boolean;

  /** Controls which Eden runtime helpers are injected into the app */
  injections?: WindowInjectionOptions;
}

/**
 * App Manifest Interface
 *
 * Defines the structure of an Eden app package.
 * Each app must include a manifest.json file with this structure.
 */
export interface AppManifest {
  /** Unique identifier for the app (e.g., "com.example.myapp") */
  id: string;

  /** Human-readable name */
  name: string;

  /** Version string (semver recommended) */
  version: string;

  /** App description */
  description?: string;

  /** App author information */
  author?: string;

  /** Entry point for the backend worker thread */
  backend?: {
    /** Path to the backend entry file (relative to app root) */
    entry: string;

    /** Worker thread options */
    options?: {
      /** Resource limits for the worker */
      resourceLimits?: {
        maxOldGenerationSizeMb?: number;
        maxYoungGenerationSizeMb?: number;
        codeRangeSizeMb?: number;
      };
    };
  };

  /** Frontend configuration */
  frontend: {
    /** Path to the frontend HTML entry file */
    entry: string;

    /** WebContentsView options */
    options?: {
      /** Enable Node.js integration in the view (default: false) */
      nodeIntegration?: boolean;

      /** Enable context isolation (default: true) */
      contextIsolation?: boolean;

      /** Preload script path (relative to app root) */
      preload?: string;
    };
  };

  /** Window configuration */
  window?: WindowConfig;

  /** App icon path (relative to app root) */
  icon?: string;
}

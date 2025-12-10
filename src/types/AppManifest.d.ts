/**
 * Window Mode Configuration
 *
 * Defines how an app's window can be displayed
 */
export type WindowMode = "floating" | "tiled" | "both";

/**
 * CSS injection mode for app views
 * - "full": Inject complete CSS (tokens + utilities + components)
 * - "tokens": Inject only CSS custom property definitions
 * - "none": Don't inject any CSS
 */
export type CSSInjectionMode = "full" | "tokens" | "none";

export interface WindowInjectionOptions {
  /** 
   * Control Eden design system CSS injection (default: "full")
   * - "full": Complete CSS including tokens, utilities, and components
   * - "tokens": Only CSS custom property definitions (variables)
   * - "none": No CSS injection
   */
  css?: CSSInjectionMode;

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
 * File handler configuration for apps that can open files
 */
export interface FileHandlerConfig {
  /** Display name for this handler (e.g., "Text Documents") */
  name: string;

  /** File extensions this handler supports (without dot, e.g., ["txt", "md"]) */
  extensions: string[];

  /** MIME types this handler supports (optional) */
  mimeTypes?: string[];

  /** Icon for this handler (optional) */
  icon?: string;
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

  /** Build configuration (for prebuilt apps) */
  build?: {
    /** Command to build the app (e.g., "npm run build") */
    command: string;
    /** Working directory for build command (relative to app root) */
    cwd?: string;
  };

  /** Internal flag indicating if this is a prebuilt system app */
  isPrebuilt?: boolean;

  /** 
   * Permissions requested by this app.
   * Supports glob patterns: "fs/*" for all fs permissions, "*" for all permissions.
   */
  permissions?: string[];

  /**
   * File types this app can handle.
   * Used for "open with" functionality and automatic handler detection.
   */
  fileHandlers?: FileHandlerConfig[];
}


import type { ServiceDeclaration } from "./channels";

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
   * Control Eden CSS injection (default: "full")
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
 * Supported setting input types
 */
export type SettingType =
  | "text"
  | "number"
  | "checkbox"
  | "radio"
  | "select"
  | "toggle"
  | "textarea"
  | "color"
  | "range";

/**
 * Option for radio/select settings
 */
export interface SettingOption {
  /** Value stored when this option is selected */
  value: string;
  /** Display label for this option */
  label: string | Record<string, string>;
  /** Optional description for this option */
  description?: string | Record<string, string>;
}

/**
 * Individual setting definition
 */
export interface SettingDefinition {
  /** Unique key for this setting */
  key: string;
  /** Display label */
  label: string | Record<string, string>;
  /** Description shown as help text */
  description?: string | Record<string, string>;
  /** Grant key used for access control */
  grant?: string;
  /** Input type */
  type: SettingType;
  /** Default value (as string, will be parsed based on type) */
  defaultValue?: string;
  /** Options for radio/select types */
  options?: SettingOption[];
  /** Placeholder for text/textarea */
  placeholder?: string;
  /** Min value for number/range */
  min?: number;
  /** Max value for number/range */
  max?: number;
  /** Step for number/range */
  step?: number;
}

/**
 * Settings category (group of related settings)
 */
export interface SettingsCategory {
  /** Category ID */
  id: string;
  /** Display name */
  name: string | Record<string, string>;
  /** Category description (optional) */
  description?: string | Record<string, string>;
  /** Category icon (optional) */
  icon?: string;
  /** Optional custom view ID for system settings */
  view?: string;
  /** Grant key used for access control */
  grant?: string;
  /** Grant scope (default: "settings") */
  grantScope?: "settings" | "global";
  /** Settings in this category */
  settings: SettingDefinition[];
}

/**
 * App-specific grant definition
 */
export type AppGrantDefinition =
  | AppGrantDefinitionApp
  | AppGrantDefinitionPreset;

export interface AppGrantDefinitionApp {
  /** Grant scope (default) */
  scope?: "app";
  /** Grant ID (namespaced by app ID at runtime) */
  id: string;
  /** Human-readable label */
  label: string | Record<string, string>;
  /** Optional description */
  description?: string | Record<string, string>;
  /** Optional permissions unlocked by this grant */
  permissions?: string[];
}

export interface AppGrantDefinitionPreset {
  /** Grant scope */
  scope: "preset";
  /** Preset ID (resolved by Eden at runtime) */
  preset: string;
}

/**
 * Resolved grant definition with full metadata.
 * Used after preset resolution - both app and preset grants normalize to this shape.
 */
export interface ResolvedGrant {
  /** Grant scope - "app" for app-specific, "preset" for system-wide presets */
  scope: "app" | "preset";
  /** Grant ID - unique identifier for this grant */
  id: string;
  /** Human-readable label */
  label: string | Record<string, string>;
  /** Optional description */
  description?: string | Record<string, string>;
  /** Permissions unlocked by this grant */
  permissions: string[];
  /** Original preset ID (only present for preset grants) */
  preset?: string;
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

  /**
   * Human-readable name.
   * Can be a simple string or a map of locales to names (e.g. { "en": "Files", "pl": "Pliki" })
   */
  name: string | Record<string, string>;

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

  /**
   * Frontend configuration.
   * Optional - omit for backend-only apps (daemons).
   * At least one of `frontend` or `backend` must be defined.
   */
  frontend?: {
    /** Path to the frontend HTML entry file */
    entry: string;

    /**
     * Allow remote URLs to be embedded in iframes.
     * When true, strips X-Frame-Options and CSP frame-ancestors headers
     * that would otherwise prevent embedding.
     * Only applies to remote (http/https) frontend entries.
     */
    allowEmbedding?: boolean;

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

  /**
   * Whether this app runs as a system overlay.
   * Overlays are rendered above regular apps.
   */
  overlay?: boolean;

  /**
   * Whether this app is hidden from the app launcher/dock.
   * Hidden apps are not shown in listed apps unless explicitly requested.
   */
  hidden?: boolean;

  /**
   * Services this app exposes for other apps to connect to.
   * Declaring services here documents the app's API and enables
   * optional access control via allowedClients.
   */
  services?: ServiceDeclaration[];

  /**
   * App settings configuration.
   * Defines settings categories and individual settings that can be configured.
   */
  settings?: SettingsCategory[];

  /**
   * App-specific user grants for feature-level access control.
   */
  grants?: AppGrantDefinition[];

  /**
   * Additional files or directories to include in the bundle.
   * Use this to include files that are normally excluded (e.g., node_modules with native bindings).
   * Paths are relative to the app root.
   * @example ["node_modules/@linuxcnc-node/core", "node_modules/better-sqlite3"]
   */
  include?: string[];
}

/**
 * Runtime App Manifest
 *
 * Extended manifest with computed runtime fields.
 * This is what Eden uses internally after loading and processing an app.
 */
export interface RuntimeAppManifest extends AppManifest {
  /** Whether this is a prebuilt system app */
  isPrebuilt: boolean;

  /** Whether this is a core app (always allowed to launch) */
  isCore: boolean;

  /** Whether this app is restricted to vendor users */
  isRestricted: boolean;

  /** Grants with presets resolved to full definitions */
  resolvedGrants: ResolvedGrant[];
}

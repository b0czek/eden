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

  /** Permissions requested by the app */
  permissions?: {
    /** File system access */
    filesystem?: {
      read?: string[]; // Array of paths/globs
      write?: string[]; // Array of paths/globs
    };

    /** Network access */
    network?: {
      domains?: string[]; // Allowed domains
    };

    /** System access */
    system?: {
      clipboard?: boolean;
      notifications?: boolean;
    };
  };

  /** App icon path (relative to app root) */
  icon?: string;
}

/**
 * App Instance Interface
 *
 * Represents a running app instance in the Eden environment
 */
export interface AppInstance {
  /** App manifest */
  manifest: AppManifest;

  /** Unique instance ID */
  instanceId: string;

  /** Installation path on disk */
  installPath: string;

  /** Worker thread handle (only present if backend exists) */
  worker?: any | null; // Worker type from worker_threads

  /** WebContentsView ID */
  viewId: number;

  /** Current state */
  state: "starting" | "running" | "paused" | "stopped" | "error";

  /** Installation timestamp */
  installedAt: Date;

  /** Last launched timestamp */
  lastLaunched?: Date;
}

/**
 * IPC Message Interface
 *
 * Standard message format for IPC communication
 */
export interface IPCMessage {
  /** Message type/action */
  type: string;

  /** Source app ID (or 'system' for system messages) */
  source: string;

  /** Target app ID (or 'system' for system messages) */
  target: string;

  /** Message payload */
  payload: any;

  /** Unique message ID for tracking responses */
  messageId: string;

  /** If this is a response to another message, the original message ID */
  replyTo?: string;

  /** Timestamp */
  timestamp: number;
}

/**
 * Shell Command Types
 *
 * Type-safe command definitions for shell operations
 */

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ShellCommand =
  | {
      command: "launch-app";
      args: {
        appId: string;
        bounds?: ViewBounds;
      };
    }
  | {
      command: "stop-app";
      args: {
        appId: string;
      };
    }
  | {
      command: "install-app";
      args: {
        sourcePath: string;
      };
    }
  | {
      command: "uninstall-app";
      args: {
        appId: string;
      };
    }
  | {
      command: "list-apps";
      args: Record<string, never>;
    }
  | {
      command: "update-view-bounds";
      args: {
        appId: string;
        bounds: ViewBounds;
      };
    }
  | {
      command: "update-workspace-bounds";
      args: {
        bounds: ViewBounds;
      };
    }
  | {
      command: "set-view-visibility";
      args: {
        appId: string;
        visible: boolean;
      };
    }
  | {
      command: "focus-app";
      args: {
        appId: string;
      };
    }
  | {
      command: "toggle-view-mode";
      args: {
        appId: string;
        mode?: "floating" | "tiled";
      };
    }
  | {
      command: "start-drag";
      args: {
        appId: string;
        startX: number;
        startY: number;
      };
    }
  | {
      command: "end-drag";
      args: {
        appId: string;
      };
    }
  | {
      command: "start-resize";
      args: {
        appId: string;
        startX: number;
        startY: number;
      };
    }
  | {
      command: "end-resize";
      args: {
        appId: string;
      };
    }
  | {
      command: "global-mouseup";
      args: Record<string, never>;
    };

export type ShellCommandType = ShellCommand["command"];
export type ShellCommandArgs<T extends ShellCommandType> = Extract<
  ShellCommand,
  { command: T }
>["args"];

/**
 * AppManager Event Types
 *
 * Type-safe event definitions for AppManager
 */

export type AppManagerEvent =
  | {
      event: "app-installed";
      data: {
        manifest: AppManifest;
      };
    }
  | {
      event: "app-uninstalled";
      data: {
        appId: string;
      };
    }
  | {
      event: "app-launched";
      data: {
        instance: AppInstance;
      };
    }
  | {
      event: "app-stopped";
      data: {
        appId: string;
      };
    }
  | {
      event: "app-error";
      data: {
        appId: string;
        error: any;
      };
    }
  | {
      event: "app-exited";
      data: {
        appId: string;
        code: number;
      };
    }
  | {
      event: "command-error";
      data: {
        command: string;
        error: any;
      };
    };

export type AppManagerEventType = AppManagerEvent["event"];
export type AppManagerEventData<T extends AppManagerEventType> = Extract<
  AppManagerEvent,
  { event: T }
>["data"];

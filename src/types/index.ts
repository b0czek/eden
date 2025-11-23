import { AppManifest } from './AppManifest';

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

export * from './AppManifest';

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
 * 
 * @deprecated Use CommandName, CommandArgs from "./commands" instead.
 * These types are kept for backward compatibility during migration.
 */

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * @deprecated Use CommandName from "./commands" instead
 */
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
    }
  | {
      command: "get-window-size";
      args: Record<string, never>;
    };

/**
 * @deprecated Use CommandName from "./commands" instead
 */
export type ShellCommandType = ShellCommand["command"];

/**
 * @deprecated Use CommandArgs from "./commands" instead
 */
export type ShellCommandArgs<T extends ShellCommandType> = Extract<
  ShellCommand,
  { command: T }
>["args"];

// Export new command types
export type { CommandName, CommandArgs, CommandResult, CommandMap } from "./commands";


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

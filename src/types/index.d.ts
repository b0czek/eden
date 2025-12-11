import { AppManifest } from "./AppManifest";

export * from "./EdenConfig";

export * from "./AppManifest";

export * from "./global";

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

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Export new command types
export type {
  CommandName,
  CommandArgs,
  CommandResult,
  CommandMap,
} from "./commands";

// Export event types
export * from "./events";

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string;
  runningApps: string[];
}

export interface WindowSize {
  width: number;
  height: number;
}

export interface LaunchResult {
  success: boolean;
  instanceId: string;
  appId: string;
}

export interface AppStatus {
  installed: AppManifest[];
  running: AppInstance[];
}

/**
 * Result of opening a file
 */
export interface FileOpenResult {
  success: boolean;
  appId?: string;
  error?: string;
}

/**
 * Information about a file handler
 */
export interface FileHandlerInfo {
  appId: string;
  appName: string;
  handlerName?: string;
  icon?: string;
}

/**
 * File or directory statistics
 */
export interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: Date;
}

/**
 * Search result for filesystem queries
 */
export interface SearchResult {
  name: string;
  path: string;
  type: "file" | "folder";
}

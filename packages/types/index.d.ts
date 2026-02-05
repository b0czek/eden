import { AppManifest } from "./AppManifest";

export * from "./EdenConfig";
export * from "./EdenSeedConfig";
export * from "./User";

export * from "./AppManifest";

export * from "./global";

export * from "./worker";

export * from "./ipc";

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

// Export channel/appbus types
export * from "./channels";

export interface SystemInfo {
  platform: string;
  arch: string;
  nodeVersion: string;
  electronVersion: string;
  runningApps: string[];
  release: boolean;
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

/**
 * Notification type/variant for styling
 */
export type NotificationType = "info" | "success" | "warning" | "danger";

/**
 * Notification data structure
 */
export interface Notification {
  id: string;
  title: string;
  message: string;
  /** Timeout in ms. If 0 or omitted, notification persists until dismissed. */
  timeout?: number;
  createdAt: number;
  /** Notification type for styling (default: info) */
  type?: NotificationType;
}

export * from "./ContextMenu";

export interface WallpaperPreset {
  id: string;
  name: string;
  type: "color" | "gradient" | "custom";
  value: string;
}

export type WallpaperConfig =
  | { type: "preset"; id: string }
  | { type: "custom"; value: string };

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

// Export new command types
export type { CommandName, CommandArgs, CommandResult, CommandMap } from "./commands";

// Export event types
export * from "./events";

// Export subscription types
export * from "./subscriptions";

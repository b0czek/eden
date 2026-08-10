export * from "./AppAssociation";
export * from "./AppManifest";
export * from "./Package";
export * from "./Branding";
export * from "./EdenConfig";
export * from "./EdenSeedConfig";
export * from "./GrantCatalog";
export * from "./global";
export * from "./ipc";
export * from "./keyboard";
export * from "./Process";
export * from "./ProcessMetrics";
export * from "./SettingsPanel";
export * from "./User";
export * from "./worker";

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
  payload: unknown;

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

export type RecursiveObject<T> = {
  [key: string]: T | RecursiveObject<T>;
};

// Export channel/appbus types
export * from "./channels";
// Export new command types
export type {
  CommandArgs,
  CommandMap,
  CommandName,
  CommandResult,
} from "./commands";
// Export event types
export * from "./events";

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

/** Kind of update delivered by a filesystem watch subscription. */
export type FilesystemChangeKind = "change" | "watch-error";

/** Arguments shared by the recursive filesystem copy and move commands. */
export interface FilesystemTransferArgs {
  from: string;
  to: string;
  /** Replace the complete destination when it already exists. */
  overwrite?: boolean;
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

export interface NotificationAction {
  id: string;
  label: string;
  dismissOnClick?: boolean;
}

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
  actions?: NotificationAction[];
}

export * from "./ContextMenu";
export * from "./FilePicker";

export interface WallpaperPreset {
  id: string;
  name: string;
  type: "color" | "gradient" | "custom";
  value: string;
}

export type WallpaperConfig =
  | { type: "preset"; id: string }
  | { type: "custom"; value: string };

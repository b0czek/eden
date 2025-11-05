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
  backend: {
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

  /** Worker thread handle */
  worker: any; // Worker type from worker_threads

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

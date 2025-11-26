import { ViewBounds } from "./index";

/**
 * AppEvents - Events sent from backend to renderer
 * 
 * All events are sent via the unified 'shell-message' channel.
 * Views must subscribe to specific events to receive them.
 */
export interface AppEvents {
  
  "view/bounds-updated": ViewBounds;
  "view/workspace-bounds-changed": { bounds: ViewBounds };

  "package/installed": { manifest: import("./AppManifest").AppManifest };
  "package/uninstalled": { appId: string };
  "process/launched": { instance: import("./index").AppInstance };
  "process/stopped": { appId: string };
  "process/error": { appId: string; error: any };
  "process/exited": { appId: string; code: number };
}

// Runtime list of all valid events
export const APP_EVENT_NAMES = [
  
  "view/bounds-updated",
  "view/workspace-bounds-changed",

  // Internal manager events (EventEmitter - not IPC)
  "package/installed",
  "package/uninstalled",
  "process/launched",
  "process/stopped",
  "process/error",
  "process/exited",
] as const;

/**
 * Utility types for working with AppEvents
 */
export type EventName = typeof APP_EVENT_NAMES[number];
export type EventData<T extends EventName> = AppEvents[T];

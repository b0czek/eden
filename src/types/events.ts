import { ViewBounds } from "./index";

/**
 * AppEvents - Events sent from backend to renderer
 * 
 * Includes both:
 * 1. Direct channel events (sent to specific app view)
 * 2. System broadcast events (sent to shell/system via system-message channel)
 */
export interface AppEvents {
  // Direct view events (IPC)
  "app/bounds-updated": ViewBounds;
  "app/init-api": { appId: string; channel: string; requestChannel: string };
  "app/set-channel": { channel: string; requestChannel: string };

  // System broadcast events (IPC - sent to shell/system via system-message channel)
  "app/launched": { appId: string; instanceId: string };
  "app/stopped": { appId: string };
  "app/workspace-bounds-changed": { bounds: ViewBounds };

  // Internal manager events (EventEmitter - not IPC)
  "package/installed": { manifest: import("./AppManifest").AppManifest };
  "package/uninstalled": { appId: string };
  "process/launched": { instance: import("./index").AppInstance };
  "process/stopped": { appId: string };
  "process/error": { appId: string; error: any };
  "process/exited": { appId: string; code: number };
  "command/error": { command: string; error: any };
}

/**
 * Utility types for working with AppEvents
 */
export type EventName = keyof AppEvents;
export type EventData<T extends EventName> = AppEvents[T];

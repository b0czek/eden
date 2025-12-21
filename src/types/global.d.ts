// Ambient declarations for renderer globals

import type { CommandName, CommandArgs, CommandResult } from "./commands";
import type { EventName, EventData } from "./events";

export interface EdenAPI {
  /**
   * Execute a shell command with type-safe arguments
   * @param command - The command name (e.g., "process/launch")
   * @param args - Type-safe arguments for the command
   * @returns Promise with the command result
   * 
   * @example
   * ```typescript
   * await edenAPI.shellCommand("process/launch", { 
   *   appId: "my-app",
   *   bounds: { x: 0, y: 0, width: 800, height: 600 }
   * });
   * ```
   */
  shellCommand<T extends CommandName>(
    command: T,
    args: CommandArgs<T>
  ): Promise<CommandResult<T>>;
  
  /**
   * Subscribe to a system event
   * @param event - The event name
   * @param callback - Callback function receiving typed event data
   */
  subscribe<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void
  ): Promise<void>;

  /**
   * Unsubscribe from a system event
   */
  unsubscribe<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void
  ): void;

  /**
   * Check if an event is supported by the system
   */
  isEventSupported(event: string): Promise<boolean>;

  /**
   * Get the launch arguments passed to this app.
   * Fetches from main process - always returns current data.
   */
  getLaunchArgs(): Promise<string[]>;
}
export interface EdenFrame {

  // Public API
  setTitle: (title: string) => void;
  
  // Internal state (used by frame system)
  _internal: {
    injected: boolean;
    config: {
      mode?: 'tiled' | 'floating' | 'both';
      showTitle?: boolean;
      defaultSize?: { width: number; height: number };
      defaultPosition?: { x: number; y: number };
      movable?: boolean;
      resizable?: boolean;
      minSize?: { width: number; height: number };
      maxSize?: { width: number; height: number };
    };
    currentMode: 'tiled' | 'floating';
    bounds: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  };
}

declare global {
  interface Window {
    /**
     * Eden API instance available only in renderer processes
     */
    edenAPI?: EdenAPI;
    edenFrame?: EdenFrame;
  }
}

// This export is important - it marks the file as a module
export {};
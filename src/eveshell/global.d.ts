// Ambient declarations for renderer globals

// Import command types
type CommandName = import("../types/commands").CommandName;
type CommandArgs<T extends CommandName> = import("../types/commands").CommandArgs<T>;
type CommandResult<T extends CommandName> = import("../types/commands").CommandResult<T>;
type EventName = import("../types/events").EventName;
type EventData<T extends EventName> = import("../types/events").EventData<T>;

interface EdenAPI {
  /**
   * Execute a shell command with type-safe arguments
   * @param command - The command name (e.g., "process/launch")
   * @param args - Type-safe arguments for the command
   * @returns Promise with the command result
   * 
   * @example
   * ```typescript
   * // TypeScript will autocomplete command names and validate args
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
  selectDirectory: () => Promise<string | null>;
  selectFile: (options?: { title?: string; filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
}

interface Window {
  edenAPI: EdenAPI;
}

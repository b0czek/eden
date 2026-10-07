/**
 * Eden API Type Definitions
 *
 * Interface for shell commands and event subscriptions.
 * Used by both frontend (window.edenAPI) and backend (worker.edenAPI).
 */

import type { CommandArgs, CommandName, CommandResult } from "../commands";
import type { EventData, EventName } from "../events";
import type { FilesystemLocation } from "../Filesystem";
import type { OperationSubmission, OperationsAPI } from "../Operations";

/**
 * Eden API - shell commands and event subscriptions
 */
export interface EdenAPI {
  operations: OperationsAPI;
  /**
   * Execute a shell command with type-safe arguments
   * @param command - The command name (e.g., "process/launch")
   * @param args - Type-safe arguments for the command
   * @returns Promise with the command result
   *
   * @example
   * ```typescript
   * const launch = await edenAPI.shellCommand("process/launch", {
   *   appId: "my-app",
   *   bounds: { x: 0, y: 0, width: 800, height: 600 }
   * });
   * await launch.result();
   * ```
   */
  shellCommand<T extends CommandName>(
    command: T,
    args: CommandArgs<T>,
    submission?: OperationSubmission,
  ): Promise<CommandResult<T>>;

  /**
   * Subscribe to a system event
   * @param event - The event name
   * @param callback - Callback function receiving typed event data
   */
  subscribe<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void,
  ): Promise<void>;

  /**
   * Unsubscribe from a system event
   */
  unsubscribe<T extends EventName>(
    event: T,
    callback: (data: EventData<T>) => void,
  ): void;

  /**
   * Check if an event is supported by the system
   */
  isEventSupported(event: string): Promise<boolean>;

  /**
   * Get the launch arguments passed to this app.
   */
  getLaunchArgs(): string[];

  /** Initial file address when launched through file/open. */
  getLaunchFile(): FilesystemLocation | undefined;
}

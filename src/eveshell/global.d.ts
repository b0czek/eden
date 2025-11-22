// Ambient declarations for renderer globals

// Import command types
type CommandName = import("../types/commands").CommandName;
type CommandArgs<T extends CommandName> = import("../types/commands").CommandArgs<T>;
type CommandResult<T extends CommandName> = import("../types/commands").CommandResult<T>;

interface EdenAPI {
  getSystemInfo: () => Promise<any>;
  
  /**
   * Execute a shell command with type-safe arguments
   * @param command - The command name (e.g., "app/launch")
   * @param args - Type-safe arguments for the command
   * @returns Promise with the command result
   * 
   * @example
   * ```typescript
   * // TypeScript will autocomplete command names and validate args
   * await edenAPI.shellCommand("app/launch", { 
   *   appId: "my-app",
   *   bounds: { x: 0, y: 0, width: 800, height: 600 }
   * });
   * ```
   */
  shellCommand<T extends CommandName>(
    command: T,
    args: CommandArgs<T>
  ): Promise<CommandResult<T>>;
  
  onSystemMessage: (callback: (message: any) => void) => void;
}

interface Window {
  edenAPI: EdenAPI;
}

/**
 * CommandRegistry
 *
 * Central registry for namespaced command handlers.
 * Similar to FastAPI's APIRouter pattern - allows multiple managers
 * to register their own command handlers under namespaces.
 */

export type CommandHandler<TArgs = any, TResult = any> = (
  args: TArgs
) => Promise<TResult> | TResult;

export interface CommandMetadata {
  namespace: string;
  command: string;
  handler: CommandHandler;
  target: any; // The instance that owns the handler
}

export class CommandRegistry {
  private handlers = new Map<string, CommandMetadata>();

  /**
   * Register a command handler under a namespace
   * @param namespace - The namespace (e.g., "app", "view")
   * @param command - The command name (e.g., "launch", "update-bounds")
   * @param handler - The handler function
   * @param target - The instance that owns the handler (for proper `this` binding)
   */
  register(
    namespace: string,
    command: string,
    handler: CommandHandler,
    target: any
  ): void {
    const fullCommand = `${namespace}/${command}`;

    if (this.handlers.has(fullCommand)) {
      console.warn(
        `Command handler for "${fullCommand}" is being overwritten`
      );
    }

    this.handlers.set(fullCommand, {
      namespace,
      command,
      handler,
      target,
    });

    console.log(`Registered command handler: ${fullCommand}`);
  }

  /**
   * Register multiple handlers from a manager instance
   * @param manager - The manager instance to register handlers from
   */
  registerManager(manager: any): void {
    const metadata = getManagerMetadata(manager);
    if (!metadata) {
      console.warn("Manager has no command handlers to register");
      return;
    }

    const { namespace, handlers } = metadata;

    for (const [command, methodName] of handlers.entries()) {
      const handler = manager[methodName];
      if (typeof handler === "function") {
        this.register(namespace, command, handler.bind(manager), manager);
      }
    }
  }

  /**
   * Execute a command by its full name
   * @param fullCommand - The full command name (e.g., "app/launch")
   * @param args - The command arguments
   * @returns The command result
   */
  async execute<TResult = any>(
    fullCommand: string,
    args: any
  ): Promise<TResult> {
    const metadata = this.handlers.get(fullCommand);

    if (!metadata) {
      throw new Error(`Unknown command: ${fullCommand}`);
    }

    try {
      return await metadata.handler.call(metadata.target, args);
    } catch (error) {
      console.error(`Error executing command ${fullCommand}:`, error);
      throw error;
    }
  }

  /**
   * Check if a command is registered
   */
  has(fullCommand: string): boolean {
    return this.handlers.has(fullCommand);
  }

  /**
   * Get all registered command names
   */
  getCommands(): string[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Get commands for a specific namespace
   */
  getNamespaceCommands(namespace: string): string[] {
    return Array.from(this.handlers.values())
      .filter((meta) => meta.namespace === namespace)
      .map((meta) => `${meta.namespace}/${meta.command}`);
  }

  /**
   * Clear all handlers (useful for testing)
   */
  clear(): void {
    this.handlers.clear();
  }
}

/**
 * Metadata storage for manager namespaces and handlers
 */
const MANAGER_METADATA = new Map<
  any,
  {
    namespace: string;
    handlers: Map<string, string>;
  }
>();

/**
 * Get manager metadata (namespace and handlers)
 */
export function getManagerMetadata(
  instance: any
): { namespace: string; handlers: Map<string, string> } | undefined {
  return MANAGER_METADATA.get(instance.constructor);
}

/**
 * Set manager namespace
 */
export function setManagerNamespace(target: any, namespace: string): void {
  if (!MANAGER_METADATA.has(target)) {
    MANAGER_METADATA.set(target, {
      namespace,
      handlers: new Map(),
    });
  } else {
    MANAGER_METADATA.get(target)!.namespace = namespace;
  }
}

/**
 * Add command handler to manager metadata
 */
export function addCommandHandler(
  target: any,
  command: string,
  methodName: string
): void {
  if (!MANAGER_METADATA.has(target)) {
    MANAGER_METADATA.set(target, {
      namespace: "",
      handlers: new Map(),
    });
  }

  const metadata = MANAGER_METADATA.get(target)!;
  metadata.handlers.set(command, methodName);
}

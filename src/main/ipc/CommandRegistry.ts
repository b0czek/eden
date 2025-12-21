import "reflect-metadata";
import { PermissionRegistry } from "./PermissionRegistry";

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
  permission?: string; // Full permission: "namespace/action"
  methodName: string; // Original method name for metadata lookup
}

export class CommandRegistry {
  private handlers = new Map<string, CommandMetadata>();
  private permissionRegistry?: PermissionRegistry;

  /**
   * Set the permission registry for permission checking
   */
  setPermissionRegistry(registry: PermissionRegistry): void {
    this.permissionRegistry = registry;
  }

  /**
   * Register a command handler under a namespace
   * @param namespace - The namespace (e.g., "app", "view")
   * @param command - The command name (e.g., "launch", "update-bounds")
   * @param handler - The handler function
   * @param target - The instance that owns the handler (for proper `this` binding)
   * @param methodName - The original method name for metadata lookup
   */
  register(
    namespace: string,
    command: string,
    handler: CommandHandler,
    target: any,
    methodName?: string
  ): void {
    const fullCommand = `${namespace}/${command}`;

    if (this.handlers.has(fullCommand)) {
      console.warn(
        `Command handler for "${fullCommand}" is being overwritten`
      );
    }

    // Look up permission from decorator metadata
    let permission: string | undefined;
    if (methodName && target) {
      const handlerPermission = Reflect.getMetadata(
        "eden:handler:permission",
        target.constructor.prototype,
        methodName
      );
      if (handlerPermission) {
        permission = `${namespace}/${handlerPermission}`;
      }
    }

    this.handlers.set(fullCommand, {
      namespace,
      command,
      handler,
      target,
      permission,
      methodName: methodName || "",
    });

    const permStr = permission ? ` (requires: ${permission})` : "";
    console.log(`Registered command handler: ${fullCommand}${permStr}`);
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
        this.register(namespace, command, handler.bind(manager), manager, methodName);
      }
    }
  }

  /**
   * Execute a command by its full name
   * @param fullCommand - The full command name (e.g., "process/launch")
   * @param args - The command arguments
   * @param appId - Optional app ID for permission checking
   * @returns The command result
   */
  async execute<TResult = any>(
    fullCommand: string,
    args: any,
    appId?: string
  ): Promise<TResult> {
    const metadata = this.handlers.get(fullCommand);

    if (!metadata) {
      throw new Error(`Unknown command: ${fullCommand}`);
    }

    // Check permission if required
    if (metadata.permission && appId && this.permissionRegistry) {
      if (!this.permissionRegistry.hasPermission(appId, metadata.permission)) {
        throw new Error(
          `Permission denied: ${metadata.permission} required for ${fullCommand}`
        );
      }
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

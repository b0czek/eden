import "reflect-metadata";
import { injectable, singleton, inject, delay } from "tsyringe";
import { PermissionRegistry } from "./PermissionRegistry";
import type { UserManager } from "../user/UserManager";
import { getManagerMetadata } from "./CommandMetadata";

export {
  addCommandHandler,
  getManagerMetadata,
  setManagerNamespace,
} from "./CommandMetadata";

/**
 * CommandRegistry
 *
 * Central registry for namespaced command handlers.
 * Similar to FastAPI's APIRouter pattern - allows multiple managers
 * to register their own command handlers under namespaces.
 */

export type CommandHandler<TArgs = any, TResult = any> = (
  args: TArgs,
) => Promise<TResult> | TResult;

export interface CommandMetadata {
  namespace: string;
  command: string;
  handler: CommandHandler;
  target: any; // The instance that owns the handler
  permission?: string; // Full permission: "namespace/action"
  methodName: string; // Original method name for metadata lookup
}

@singleton()
@injectable()
export class CommandRegistry {
  private handlers = new Map<string, CommandMetadata>();

  constructor(
    @inject(PermissionRegistry) private permissionRegistry: PermissionRegistry,
    @inject(delay(() => require("../user/UserManager").UserManager))
    private userManager: UserManager,
  ) {}

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
    methodName?: string,
  ): void {
    const fullCommand = `${namespace}/${command}`;

    if (this.handlers.has(fullCommand)) {
      console.warn(`Command handler for "${fullCommand}" is being overwritten`);
    }

    // Look up permission from decorator metadata
    let permission: string | undefined;
    if (methodName && target) {
      const handlerPermission = Reflect.getMetadata(
        "eden:handler:permission",
        target.constructor.prototype,
        methodName,
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
        this.register(
          namespace,
          command,
          handler.bind(manager),
          manager,
          methodName,
        );
      }
    }
    console.log(
      `Registered ${handlers.size} command handlers for namespace "${namespace}"`,
    );
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
    appId?: string,
  ): Promise<TResult> {
    const metadata = this.handlers.get(fullCommand);

    if (!metadata) {
      throw new Error(`Unknown command: ${fullCommand}`);
    }

    // Check app permission if required
    if (metadata.permission && appId) {
      // First check if app has this as a base permission
      const hasBasePermission = this.permissionRegistry.hasPermission(
        appId,
        metadata.permission,
      );

      if (!hasBasePermission) {
        // Check if app declares a grant that would unlock this permission
        const requiredGrantKeys = this.permissionRegistry.getRequiredGrantKeys(
          appId,
          metadata.permission,
        );

        if (requiredGrantKeys.length === 0) {
          // App neither has base permission nor declares any grant for it
          throw new Error(
            `Permission denied: ${metadata.permission} required for ${fullCommand}`,
          );
        }

        // Check if user has any of the grants that would unlock this permission
        const hasGrant = requiredGrantKeys.some((grantKey) =>
          this.userManager.hasGrant(grantKey),
        );

        if (!hasGrant) {
          throw new Error(
            `Grant denied: ${requiredGrantKeys.join(",")} required for ${fullCommand}`,
          );
        }
      }
    }

    return await metadata.handler.call(metadata.target, args);
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

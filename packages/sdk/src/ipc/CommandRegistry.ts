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
  grant?: string; // User grant required to execute
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
    let grant: string | undefined;
    if (methodName && target) {
      const handlerPermission = Reflect.getMetadata(
        "eden:handler:permission",
        target.constructor.prototype,
        methodName,
      );
      if (handlerPermission) {
        permission = `${namespace}/${handlerPermission}`;
      }

      grant = Reflect.getMetadata(
        "eden:handler:grant",
        target.constructor.prototype,
        methodName,
      );
    }

    this.handlers.set(fullCommand, {
      namespace,
      command,
      handler,
      target,
      permission,
      grant,
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
      // App must have declared the permission
      if (!this.permissionRegistry.hasPermission(appId, metadata.permission)) {
        throw new Error(
          `Permission denied: ${metadata.permission} required for ${fullCommand}`,
        );
      }

      // If permission requires a grant, check user has it
      const requiredGrantIds = this.permissionRegistry.getRequiredGrantIds(
        appId,
        metadata.permission,
      );
      if (requiredGrantIds.length > 0) {
        const hasGrant = requiredGrantIds.some((grantId) =>
          this.userManager.hasGrant(`app/${appId}/${grantId}`),
        );
        if (!hasGrant) {
          throw new Error(
            `Grant denied: app/${appId}/${requiredGrantIds.join(",")} required for ${fullCommand}`,
          );
        }
      }
    }

    // Check direct user grant if required - decorator has grant requirement declared
    if (metadata.grant) {
      if (!this.userManager.hasGrant(metadata.grant)) {
        throw new Error(
          `Grant denied: ${metadata.grant} required for ${fullCommand}`,
        );
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

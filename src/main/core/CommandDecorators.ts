import {
  setManagerNamespace,
  addCommandHandler,
} from "./CommandRegistry";

/**
 * Class decorator to set the namespace for all command handlers in a manager
 * @param namespace - The namespace for this manager (e.g., "app", "view")
 * 
 * @example
 * ```typescript
 * @CommandNamespace("app")
 * class AppManager {
 *   @CommandHandler("launch")
 *   async handleLaunch(args: { appId: string }) {
 *     // This becomes "app/launch"
 *   }
 * }
 * ```
 */
export function CommandNamespace(namespace: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    setManagerNamespace(constructor, namespace);
    return constructor;
  };
}

/**
 * Method decorator to register a method as a command handler
 * @param command - The command name (will be prefixed with the class namespace)
 * 
 * @example
 * ```typescript
 * @CommandNamespace("app")
 * class AppManager {
 *   @CommandHandler("launch")
 *   async handleLaunch(args: { appId: string }) {
 *     // Registered as "app/launch"
 *   }
 * }
 * ```
 */
export function CommandHandler(command: string) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Register this handler in metadata
    addCommandHandler(target.constructor, command, propertyKey);
    return descriptor;
  };
}

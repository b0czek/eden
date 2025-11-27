import {
  setManagerNamespace,
  addCommandHandler,
} from "./CommandRegistry";

/**
 * Options for the EdenNamespace decorator
 */
export interface EdenNamespaceOptions {
  /**
   * Optional event interface name for this namespace
   * The interface should define events without the namespace prefix
   * 
   * @example
   * ```typescript
   * interface ProcessNamespaceEvents {
   *   "launched": { instance: AppInstance };
   *   "stopped": { appId: string };
   * }
   * 
   * @EdenNamespace("process", { events: "ProcessNamespaceEvents" })
   * class ProcessManager {
   *   // ...
   * }
   * ```
   */
  events?: string;
}

/**
 * Class decorator to set the namespace for all command handlers and events in a manager
 * @param namespace - The namespace for this manager (e.g., "process", "view")
 * @param options - Optional configuration including event interface
 * 
 * @example
 * ```typescript
 * interface ProcessEvents {
 *   "launched": { appId: string };
 * }
 * 
 * @EdenNamespace("process", { events: ProcessEvents })
 * class ProcessManager {
 *   @EdenHandler("launch")
 *   async handleLaunch(args: { appId: string }) {
 *     // This becomes "process/launch"
 *   }
 * }
 * ```
 */
export function EdenNamespace(namespace: string, options?: EdenNamespaceOptions) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    setManagerNamespace(constructor, namespace);
    
    // Store events interface name if provided for codegen
    if (options?.events) {
      Reflect.defineMetadata("eden:events", options.events, constructor);
    }
    
    return constructor;
  };
}

/**
 * Method decorator to register a method as a command handler
 * @param command - The command name (will be prefixed with the class namespace)
 * 
 * @example
 * ```typescript
 * @EdenNamespace("process")
 * class ProcessManager {
 *   @EdenHandler("launch")
 *   async handleLaunch(args: { appId: string }) {
 *     // Registered as "process/launch"
 *   }
 * }
 * ```
 */
export function EdenHandler(command: string) {
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

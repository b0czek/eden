import { ShellCommandType } from "../../types";

/**
 * Metadata storage for command handlers
 */
const COMMAND_HANDLERS = new Map<any, Map<ShellCommandType, string>>();

/**
 * Decorator to register a method as a command handler
 */
export function CommandHandler(commandType: ShellCommandType) {
  return function (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    // Get or create handlers map for this class
    if (!COMMAND_HANDLERS.has(target.constructor)) {
      COMMAND_HANDLERS.set(target.constructor, new Map());
    }

    const handlers = COMMAND_HANDLERS.get(target.constructor)!;
    handlers.set(commandType, propertyKey);

    return descriptor;
  };
}

/**
 * Get all registered command handlers for a class instance
 */
export function getCommandHandlers(
  instance: any
): Map<ShellCommandType, string> {
  return COMMAND_HANDLERS.get(instance.constructor) || new Map();
}

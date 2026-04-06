export interface ManagerMetadata {
  namespace: string;
  handlers: Map<string, string>;
}

interface ManagedInstance {
  constructor: object;
}

/**
 * Metadata storage for manager namespaces and handlers.
 * Kept in a separate module to avoid circular dependencies between decorators
 * and the command registry.
 */
const MANAGER_METADATA = new Map<object, ManagerMetadata>();

/**
 * Get manager metadata (namespace and handlers).
 */
export function getManagerMetadata(
  instance: ManagedInstance,
): ManagerMetadata | undefined {
  return MANAGER_METADATA.get(instance.constructor);
}

/**
 * Set manager namespace.
 */
export function setManagerNamespace(target: object, namespace: string): void {
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
 * Add command handler to manager metadata.
 */
export function addCommandHandler(
  target: object,
  command: string,
  methodName: string,
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

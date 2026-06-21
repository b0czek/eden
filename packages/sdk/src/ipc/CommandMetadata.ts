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
  const existing = MANAGER_METADATA.get(target);
  if (existing) {
    existing.namespace = namespace;
    return;
  }

  MANAGER_METADATA.set(target, {
    namespace,
    handlers: new Map(),
  });
}

/**
 * Add command handler to manager metadata.
 */
export function addCommandHandler(
  target: object,
  command: string,
  methodName: string,
): void {
  let metadata = MANAGER_METADATA.get(target);
  if (!metadata) {
    metadata = {
      namespace: "",
      handlers: new Map(),
    };
    MANAGER_METADATA.set(target, metadata);
  }

  metadata.handlers.set(command, methodName);
}

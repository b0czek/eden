/**
 * PermissionRegistry
 *
 * Central registry for managing app permissions at runtime.
 * Supports glob patterns for permission matching:
 * - "fs/read" matches exactly "fs/read"
 * - "fs/*" matches any permission starting with "fs/"
 * - "*" matches all permissions
 */

import { singleton, injectable } from "tsyringe";

@singleton()
@injectable()
export class PermissionRegistry {
  private appPermissions: Map<string, Set<string>> = new Map();

  /**
   * Register permissions for an app (called during install/load)
   */
  registerApp(appId: string, permissions: string[]): void {
    this.appPermissions.set(appId, new Set(permissions));
    console.log(
      `[PermissionRegistry] Registered ${permissions.length} permissions for ${appId}`
    );
  }

  /**
   * Unregister app permissions (called during uninstall)
   */
  unregisterApp(appId: string): void {
    this.appPermissions.delete(appId);
    console.log(`[PermissionRegistry] Unregistered permissions for ${appId}`);
  }

  /**
   * Check if an app has a specific permission.
   * Supports glob patterns in the app's granted permissions.
   */
  hasPermission(appId: string, requiredPermission: string): boolean {
    const permissions = this.appPermissions.get(appId);
    if (!permissions) {
      return false;
    }

    // Check for exact match first
    if (permissions.has(requiredPermission)) {
      return true;
    }

    // Check for glob patterns
    for (const granted of permissions) {
      if (this.matchesGlob(granted, requiredPermission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Match a glob pattern against a permission.
   * - "*" matches everything
   * - "namespace/*" matches anything starting with "namespace/"
   */
  private matchesGlob(pattern: string, permission: string): boolean {
    // Wildcard matches everything
    if (pattern === "*") {
      return true;
    }

    // Namespace wildcard: "fs/*" matches "fs/read", "fs/write", etc.
    if (pattern.endsWith("/*")) {
      const namespace = pattern.slice(0, -2); // Remove "/*"
      return permission.startsWith(namespace + "/");
    }

    return false;
  }

  /**
   * Get all permissions for an app
   */
  getPermissions(appId: string): string[] {
    const permissions = this.appPermissions.get(appId);
    return permissions ? Array.from(permissions) : [];
  }

  /**
   * Check if an app is registered
   */
  hasApp(appId: string): boolean {
    return this.appPermissions.has(appId);
  }
}

/**
 * Event Permission Registry
 *
 * Stores which permissions are required to subscribe to specific events.
 */
const EVENT_PERMISSIONS: Map<string, string> = new Map();

/**
 * Register an event's required permission
 */
export function registerEventPermission(
  eventName: string,
  permission: string
): void {
  EVENT_PERMISSIONS.set(eventName, permission);
}

/**
 * Get the permission required to subscribe to an event
 */
export function getEventPermission(eventName: string): string | undefined {
  return EVENT_PERMISSIONS.get(eventName);
}

/**
 * Get all registered event permissions
 */
export function getAllEventPermissions(): Map<string, string> {
  return new Map(EVENT_PERMISSIONS);
}

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
import type { AppGrantDefinition } from "@edenapp/types";

/**
 * Per-app permission state
 */
interface AppPermissionState {
  /** Base permissions from manifest - always available when app runs */
  basePermissions: Set<string>;
  /** Grants: grantId → Set of permissions it unlocks */
  grants: Map<string, Set<string>>;
}

@singleton()
@injectable()
export class PermissionRegistry {
  private apps: Map<string, AppPermissionState> = new Map();

  /**
   * Register permissions for an app from manifest data.
   */
  registerApp(
    appId: string,
    permissions?: string[],
    grants?: AppGrantDefinition[],
  ): void {
    const basePermissions = new Set(
      Array.isArray(permissions) ? permissions : [],
    );

    const grantMap = new Map<string, Set<string>>();
    for (const grant of grants ?? []) {
      const perms = grant.permissions ?? [];
      if (perms.length > 0) {
        grantMap.set(grant.id, new Set(perms));
      }
    }

    if (basePermissions.size === 0 && grantMap.size === 0) {
      this.unregisterApp(appId);
      return;
    }

    this.apps.set(appId, { basePermissions, grants: grantMap });

    const totalPerms = basePermissions.size + grantMap.size;
    console.log(
      `[PermissionRegistry] Registered app ${appId} (${basePermissions.size} base, ${grantMap.size} grants)`,
    );
  }

  /**
   * Unregister app permissions (called during uninstall)
   */
  unregisterApp(appId: string): void {
    this.apps.delete(appId);
    console.log(`[PermissionRegistry] Unregistered permissions for ${appId}`);
  }

  /**
   * Check if an app has a specific permission (base or via any grant).
   */
  hasPermission(appId: string, requiredPermission: string): boolean {
    const state = this.apps.get(appId);
    if (!state) return false;

    // Check base permissions
    if (this.matchesAny(state.basePermissions, requiredPermission)) {
      return true;
    }

    // Check grant permissions
    for (const permissions of state.grants.values()) {
      if (this.matchesAny(permissions, requiredPermission)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if a permission is a base permission (no grant required).
   */
  isBasePermission(appId: string, requiredPermission: string): boolean {
    const state = this.apps.get(appId);
    if (!state) return false;
    return this.matchesAny(state.basePermissions, requiredPermission);
  }

  /**
   * Return grant IDs that unlock a permission for this app.
   * If the permission is a base permission, returns empty array.
   */
  getRequiredGrantIds(appId: string, requiredPermission: string): string[] {
    if (this.isBasePermission(appId, requiredPermission)) {
      return [];
    }

    const state = this.apps.get(appId);
    if (!state) return [];

    const matching: string[] = [];
    for (const [grantId, permissions] of state.grants) {
      if (this.matchesAny(permissions, requiredPermission)) {
        matching.push(grantId);
      }
    }
    return matching;
  }

  /**
   * Check if an app is registered
   */
  hasApp(appId: string): boolean {
    return this.apps.has(appId);
  }

  /**
   * Check if any permission pattern matches the required permission.
   */
  private matchesAny(
    permissions: Iterable<string>,
    requiredPermission: string,
  ): boolean {
    for (const pattern of permissions) {
      if (pattern === requiredPermission) return true;
      if (pattern === "*") return true;
      if (pattern.endsWith("/*")) {
        const namespace = pattern.slice(0, -2);
        if (requiredPermission.startsWith(namespace + "/")) return true;
      }
    }
    return false;
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
  permission: string,
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

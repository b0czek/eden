import { log } from "../logging";

/**
 * PermissionRegistry
 *
 * Central registry for managing app permissions at runtime.
 * Tracks:
 * - Base permissions: what the app always has (from manifest.permissions)
 * - Grant permissions: what the app CAN have if the user has the grant (from manifest.grants)
 *
 * Supports glob patterns for permission matching:
 * - "fs/read" matches exactly "fs/read"
 * - "fs/*" matches any permission starting with "fs/"
 * - "*" matches all permissions
 */

import type { ResolvedGrant } from "@edenapp/types";
import { injectable, Lifecycle, scoped } from "tsyringe";

/**
 * Per-app permission state
 */
interface AppPermissionState {
  /** Base permissions from manifest - always available when app runs */
  basePermissions: Set<string>;
  /** Grants: grantKey → permissions it unlocks */
  grants: Map<string, { permissions: Set<string> }>;
}

@scoped(Lifecycle.ContainerScoped)
@injectable()
export class PermissionRegistry {
  private apps: Map<string, AppPermissionState> = new Map();
  private eventPermissions = new Map<string, string>();

  /**
   * Register permissions for an app from manifest data.
   * Grants should be pre-resolved via normalizeGrantPresets.
   */
  registerApp(
    appId: string,
    permissions?: string[],
    grants?: ResolvedGrant[],
  ): void {
    const basePermissions = new Set(
      Array.isArray(permissions) ? permissions : [],
    );

    const grantMap = new Map<string, { permissions: Set<string> }>();
    for (const grant of grants ?? []) {
      if (!grant.id || grant.permissions.length === 0) {
        continue;
      }

      // Build grant key based on scope
      const grantKey =
        grant.scope === "preset"
          ? `preset/${grant.id}`
          : `app/${appId}/${grant.id}`;

      grantMap.set(grantKey, {
        permissions: new Set(grant.permissions),
      });
    }

    if (basePermissions.size === 0 && grantMap.size === 0) {
      this.unregisterApp(appId);
      return;
    }

    this.apps.set(appId, { basePermissions, grants: grantMap });

    log.info(
      `Registered app ${appId} (${basePermissions.size} base, ${grantMap.size} grants)`,
    );
  }

  /**
   * Unregister app permissions (called during uninstall)
   */
  unregisterApp(appId: string): void {
    this.apps.delete(appId);
    log.info(`Unregistered permissions for ${appId}`);
  }

  /**
   * Check if an app has a specific permission as a BASE permission.
   * This does NOT check grants - use getRequiredGrantKeys for that.
   */
  hasPermission(appId: string, requiredPermission: string): boolean {
    const state = this.apps.get(appId);
    if (!state) return false;
    return this.matchesAny(state.basePermissions, requiredPermission);
  }

  /**
   * Return grant keys that would unlock a permission for this app.
   * If the permission is a base permission, returns empty array.
   * The caller should check if the user has any of these grants.
   */
  getRequiredGrantKeys(appId: string, requiredPermission: string): string[] {
    const state = this.apps.get(appId);
    if (!state) return [];

    // If it's a base permission, no grant needed
    if (this.matchesAny(state.basePermissions, requiredPermission)) {
      return [];
    }

    // Find grants that would unlock this permission
    const matching: string[] = [];
    for (const [grantKey, grant] of state.grants) {
      if (this.matchesAny(grant.permissions, requiredPermission)) {
        matching.push(grantKey);
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
        if (requiredPermission.startsWith(`${namespace}/`)) return true;
      }
    }
    return false;
  }

  /** Register an event subscription permission for this runtime. */
  registerEventPermission(eventName: string, permission: string): void {
    this.eventPermissions.set(eventName, permission);
  }

  /** Get the event subscription permission registered in this runtime. */
  getEventPermission(eventName: string): string | undefined {
    return this.eventPermissions.get(eventName);
  }

  /** Return a defensive snapshot of this runtime's event permissions. */
  getAllEventPermissions(): Map<string, string> {
    return new Map(this.eventPermissions);
  }

  dispose(): void {
    this.apps.clear();
    this.eventPermissions.clear();
  }
}

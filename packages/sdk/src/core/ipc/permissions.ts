import { log } from "../../platform/logging/logger";

/**
 * Permissions
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
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export interface Permissions {
  registerApp: (
    appId: string,
    permissions?: string[],
    grants?: ResolvedGrant[],
  ) => void;
  unregisterApp: (appId: string) => void;
  hasPermission: (appId: string, requiredPermission: string) => boolean;
  getRequiredGrantKeys: (appId: string, requiredPermission: string) => string[];
  hasApp: (appId: string) => boolean;
  registerEventPermission: (eventName: string, permission: string) => void;
  getEventPermission: (eventName: string) => string | undefined;
  getAllEventPermissions: () => Map<string, string>;
  dispose: () => void;
}

export const Permissions = Context.Service<"eden/Permissions", Permissions>(
  "eden/Permissions",
);

/**
 * Per-app permission state
 */
interface AppPermissionState {
  /** Base permissions from manifest - always available when app runs */
  basePermissions: Set<string>;
  /** Grants: grantKey → permissions it unlocks */
  grants: Map<string, { permissions: Set<string> }>;
}

export const PermissionsLive = Layer.effect(
  Permissions,
  Effect.acquireRelease(
    Effect.sync(() => {
      const apps: Map<string, AppPermissionState> = new Map();
      const eventPermissions = new Map<string, string>();

      function registerApp(
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
          unregisterApp(appId);
          return;
        }

        apps.set(appId, { basePermissions, grants: grantMap });

        log.info(
          `Registered app ${appId} (${basePermissions.size} base, ${grantMap.size} grants)`,
        );
      }
      function unregisterApp(appId: string): void {
        apps.delete(appId);
        log.info(`Unregistered permissions for ${appId}`);
      }
      function hasPermission(
        appId: string,
        requiredPermission: string,
      ): boolean {
        const state = apps.get(appId);
        if (!state) return false;
        return matchesAny(state.basePermissions, requiredPermission);
      }
      function getRequiredGrantKeys(
        appId: string,
        requiredPermission: string,
      ): string[] {
        const state = apps.get(appId);
        if (!state) return [];

        // If it's a base permission, no grant needed
        if (matchesAny(state.basePermissions, requiredPermission)) {
          return [];
        }

        // Find grants that would unlock this permission
        const matching: string[] = [];
        for (const [grantKey, grant] of state.grants) {
          if (matchesAny(grant.permissions, requiredPermission)) {
            matching.push(grantKey);
          }
        }
        return matching;
      }
      function hasApp(appId: string): boolean {
        return apps.has(appId);
      }
      function matchesAny(
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
      function registerEventPermission(
        eventName: string,
        permission: string,
      ): void {
        eventPermissions.set(eventName, permission);
      }
      function getEventPermission(eventName: string): string | undefined {
        return eventPermissions.get(eventName);
      }
      function getAllEventPermissions(): Map<string, string> {
        return new Map(eventPermissions);
      }
      function dispose(): void {
        apps.clear();
        eventPermissions.clear();
      }
      return {
        registerApp,
        unregisterApp,
        hasPermission,
        getRequiredGrantKeys,
        hasApp,
        registerEventPermission,
        getEventPermission,
        getAllEventPermissions,
        dispose,
      };
    }),
    (value) => Effect.sync(value.dispose),
  ),
);

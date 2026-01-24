import type { UserRole } from "@edenapp/types";

export function defaultGrantsForRole(role: UserRole): string[] {
  if (role === "vendor") {
    return ["*"];
  }
  return ["apps/launch/*", "settings/*"];
}

export function normalizeGrants(role: UserRole, grants: string[]): string[] {
  if (role === "vendor") {
    return ["*"];
  }

  const unique = new Set(
    grants.map((permission) => permission.trim()).filter(Boolean),
  );
  if (unique.has("*")) {
    return ["*"];
  }
  return Array.from(unique);
}

export function normalizeCoreApps(appIds?: string[]): Set<string> {
  if (!appIds || appIds.length === 0) {
    return new Set();
  }
  const normalized = appIds.map((appId) => appId.trim()).filter(Boolean);
  return new Set(normalized);
}

export function matchesGrants(grants: string[], required: string): boolean {
  if (grants.includes(required)) {
    return true;
  }
  for (const granted of grants) {
    if (matchesGlob(granted, required)) {
      return true;
    }
  }
  return false;
}

function matchesGlob(pattern: string, permission: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const namespace = pattern.slice(0, -2);
    return permission.startsWith(`${namespace}/`);
  }
  return false;
}

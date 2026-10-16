import type { UserRole } from "@edenapp/types";

export function defaultGrantsForRole(role: UserRole): string[] {
  if (role === "vendor") {
    return ["*"];
  }
  return ["*"];
}

export function normalizeGrants(role: UserRole, grants: string[]): string[] {
  if (role === "vendor") {
    return ["*"];
  }

  const unique = new Set(grants.map((grant) => grant.trim()).filter(Boolean));
  if (unique.has("*")) {
    return ["*"];
  }
  return Array.from(unique);
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

function matchesGlob(pattern: string, grant: string): boolean {
  if (pattern === "*") return true;
  if (pattern.endsWith("/*")) {
    const namespace = pattern.slice(0, -2);
    return grant.startsWith(`${namespace}/`);
  }
  return false;
}

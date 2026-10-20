import { randomBytes } from "node:crypto";
import type { UserProfile, UserRole } from "@edenapp/types";
import { normalizeGrants } from "./grants";
import type { StoredUser } from "./types";

export function normalizeUsername(
  username: string | undefined,
  name: string,
): string {
  if (username && username.trim().length > 0) return username.trim();
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${slug || "user"}-${randomBytes(2).toString("hex")}`;
}

export function toPublicUser(user: StoredUser): UserProfile {
  return {
    username: user.username,
    name: user.name,
    role: user.role,
    directoryRestriction: user.directoryRestriction,
    grants: user.grants,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

export function normalizeUserGrants(
  role: UserRole,
  grants: string[],
  restrictedApps: ReadonlySet<string>,
): string[] {
  const normalized = normalizeGrants(role, grants);
  if (role === "vendor" || restrictedApps.size === 0) return normalized;
  return normalized.filter((grant) => {
    if (!grant.startsWith("apps/launch/")) return true;
    const appId = grant.slice("apps/launch/".length);
    return !appId || appId === "*" || !restrictedApps.has(appId);
  });
}

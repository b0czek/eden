import * as v from "valibot";
import type { StoredUser } from "./types";

const storedUserSchema = v.object({
  username: v.string(),
  name: v.string(),
  role: v.picklist(["standard", "vendor"]),
  directoryRestriction: v.optional(v.string()),
  grants: v.fallback(v.array(v.string()), []),
  createdAt: v.number(),
  updatedAt: v.number(),
  passwordHash: v.string(),
  passwordSalt: v.string(),
});

function decodeLegacyValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (cause) {
    if (cause instanceof SyntaxError) return undefined;
    throw cause;
  }
}

// Invalid persisted data retains the legacy absent-record/empty-index policy.
export function readStoredUser(value: unknown): StoredUser | null {
  const parsed = v.safeParse(storedUserSchema, decodeLegacyValue(value));
  return parsed.success ? parsed.output : null;
}

export function readUserIndex(value: unknown): string[] {
  const parsed = v.safeParse(v.array(v.string()), decodeLegacyValue(value));
  return parsed.success ? parsed.output : [];
}

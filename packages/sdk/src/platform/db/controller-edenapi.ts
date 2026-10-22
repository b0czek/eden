import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../../core/controllers/controller";
import {
  keyArgsSchema,
  namespaceArgsSchema,
  namespacedKeyArgsSchema,
} from "../../core/controllers/schemas";
import type { CommandCallerContext } from "../../core/execution/context";
import { DbCallerIdentityRequiredError } from "./errors";
import type { Db } from "./service";

function callerNamespace(caller: CommandCallerContext) {
  return caller.appId
    ? Effect.succeed(caller.appId)
    : Effect.fail(new DbCallerIdentityRequiredError());
}

export function createDbController(db: Db) {
  return defineController("db", {
    commands: {
      /** Get a value from database (scoped to caller's app) */
      get: command({
        input: keyArgsSchema,
        permission: "rw",
        handle: ({ key }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.get(appId, key), (value) => ({ value })),
          ),
      }),
      /** Set a value in database (scoped to caller's app) */
      set: command({
        input: v.object({ key: keyArgsSchema.entries.key, value: v.string() }),
        permission: "rw",
        handle: ({ key, value }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.set(appId, key, value), (): { success: boolean } => ({
              success: true,
            })),
          ),
      }),
      /** Delete a key from database (scoped to caller's app) */
      delete: command({
        input: keyArgsSchema,
        permission: "rw",
        handle: ({ key }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.delete(appId, key), (success) => ({ success })),
          ),
      }),
      /** Check if a key exists (scoped to caller's app) */
      has: command({
        input: keyArgsSchema,
        permission: "rw",
        handle: ({ key }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.has(appId, key), (exists) => ({ exists })),
          ),
      }),
      /** Clear all keys (scoped to caller's app) */
      clear: command({
        permission: "rw",
        handle: (_args, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.clear(appId), (): { success: boolean } => ({
              success: true,
            })),
          ),
      }),
      /** List all keys (scoped to caller's app) */
      list: command({
        permission: "rw",
        handle: (_args, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.list(appId), (keys) => ({ keys })),
          ),
      }),
      /** Get a value from any app's namespace (superuser only) */
      "get/su": command({
        input: namespacedKeyArgsSchema,
        permission: "superuser",
        handle: ({ appId, key }) =>
          Effect.map(db.get(appId, key), (value) => ({ value })),
      }),
      /** Set a value in any app's namespace (superuser only) */
      "set/su": command({
        input: v.object({
          appId: namespaceArgsSchema.entries.appId,
          key: keyArgsSchema.entries.key,
          value: v.string(),
        }),
        permission: "superuser",
        handle: ({ appId, key, value }) =>
          Effect.map(db.set(appId, key, value), (): { success: boolean } => ({
            success: true,
          })),
      }),
      /** Delete a key from any app's namespace (superuser only) */
      "delete/su": command({
        input: namespacedKeyArgsSchema,
        permission: "superuser",
        handle: ({ appId, key }) =>
          Effect.map(db.delete(appId, key), (success) => ({ success })),
      }),
      /** Check if a key exists in any app's namespace (superuser only) */
      "has/su": command({
        input: namespacedKeyArgsSchema,
        permission: "superuser",
        handle: ({ appId, key }) =>
          Effect.map(db.has(appId, key), (exists) => ({ exists })),
      }),
      /** Clear all keys in any app's namespace (superuser only) */
      "clear/su": command({
        input: namespaceArgsSchema,
        permission: "superuser",
        handle: ({ appId }) =>
          Effect.map(db.clear(appId), (): { success: boolean } => ({
            success: true,
          })),
      }),
      /** List all keys in any app's namespace (superuser only) */
      "list/su": command({
        input: namespaceArgsSchema,
        permission: "superuser",
        handle: ({ appId }) => Effect.map(db.list(appId), (keys) => ({ keys })),
      }),
    },
  });
}

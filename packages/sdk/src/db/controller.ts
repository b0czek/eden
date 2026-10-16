import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { CommandCallerContext } from "../execution/ExecutionContext";
import type { Db } from "./service";

function callerNamespace(caller: CommandCallerContext) {
  return caller.appId
    ? Effect.succeed(caller.appId)
    : Effect.fail(new Error("Database access requires a caller app identity"));
}

export function createDbController(db: Db) {
  return defineController("db", {
    commands: {
      /** Get a value from database (scoped to caller's app) */
      get: command({
        input: v.object({ key: v.string() }),
        permission: "rw",
        handle: ({ key }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.get(appId, key), (value) => ({ value })),
          ),
      }),
      /** Set a value in database (scoped to caller's app) */
      set: command({
        input: v.object({ key: v.string(), value: v.string() }),
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
        input: v.object({ key: v.string() }),
        permission: "rw",
        handle: ({ key }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(db.delete(appId, key), (success) => ({ success })),
          ),
      }),
      /** Check if a key exists (scoped to caller's app) */
      has: command({
        input: v.object({ key: v.string() }),
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
        input: v.object({ appId: v.string(), key: v.string() }),
        permission: "superuser",
        handle: ({ appId, key }) =>
          Effect.map(db.get(appId, key), (value) => ({ value })),
      }),
      /** Set a value in any app's namespace (superuser only) */
      "set/su": command({
        input: v.object({
          appId: v.string(),
          key: v.string(),
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
        input: v.object({ appId: v.string(), key: v.string() }),
        permission: "superuser",
        handle: ({ appId, key }) =>
          Effect.map(db.delete(appId, key), (success) => ({ success })),
      }),
      /** Check if a key exists in any app's namespace (superuser only) */
      "has/su": command({
        input: v.object({ appId: v.string(), key: v.string() }),
        permission: "superuser",
        handle: ({ appId, key }) =>
          Effect.map(db.has(appId, key), (exists) => ({ exists })),
      }),
      /** Clear all keys in any app's namespace (superuser only) */
      "clear/su": command({
        input: v.object({ appId: v.string() }),
        permission: "superuser",
        handle: ({ appId }) =>
          Effect.map(db.clear(appId), (): { success: boolean } => ({
            success: true,
          })),
      }),
      /** List all keys in any app's namespace (superuser only) */
      "list/su": command({
        input: v.object({ appId: v.string() }),
        permission: "superuser",
        handle: ({ appId }) => Effect.map(db.list(appId), (keys) => ({ keys })),
      }),
    },
  });
}

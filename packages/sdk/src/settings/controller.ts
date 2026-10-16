import type { SettingsCategory } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { CommandCallerContext } from "../execution/ExecutionContext";
import type { Settings } from "./service";

function callerNamespace(caller: CommandCallerContext) {
  return caller.appId
    ? Effect.succeed(caller.appId)
    : Effect.fail(new Error("Settings access requires a caller app identity"));
}

const resetSchema = v.optional(v.custom<SettingsCategory[]>(Array.isArray));

export function createSettingsController(settings: Settings) {
  return defineController("settings", {
    commands: {
      /** Get a setting value (scoped to caller's app) */
      get: command({
        input: v.object({ key: v.string(), appId: v.optional(v.string()) }),
        permission: "rw",
        handle: ({ key, appId }, caller) =>
          Effect.gen(function* () {
            const readerAppId = yield* callerNamespace(caller);
            const ownerAppId = appId ?? readerAppId;
            settings.assertReadableBy(ownerAppId, key, readerAppId);
            const value = yield* settings.get(ownerAppId, key);
            return { value };
          }),
      }),
      /** Set a setting value (scoped to caller's app) */
      set: command({
        input: v.object({ key: v.string(), value: v.string() }),
        permission: "rw",
        handle: ({ key, value }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(
              settings.set(appId, key, value),
              (): { success: boolean } => ({ success: true }),
            ),
          ),
      }),
      /** List all settings keys (scoped to caller's app) */
      list: command({
        permission: "rw",
        handle: (_args, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(settings.list(appId), (keys) => ({ keys })),
          ),
      }),
      /** Get all settings with values (scoped to caller's app) */
      "get-all": command({
        permission: "rw",
        handle: (_args, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(settings.getAll(appId), (values) => ({
              settings: values,
            })),
          ),
      }),
      /** Reset a setting to default (scoped to caller's app) */
      reset: command({
        input: v.object({ key: v.string(), schema: resetSchema }),
        permission: "rw",
        handle: ({ key, schema }, caller) =>
          Effect.flatMap(callerNamespace(caller), (appId) =>
            Effect.map(
              settings.reset(appId, key, schema),
              (): { success: boolean } => ({ success: true }),
            ),
          ),
      }),
      /** Get a setting from any app's namespace (superuser only) */
      "get/su": command({
        input: v.object({ appId: v.string(), key: v.string() }),
        permission: "superuser",
        handle: ({ appId, key }) =>
          Effect.gen(function* () {
            settings.assertAccess(appId, key);
            const value = yield* settings.get(appId, key);
            return { value };
          }),
      }),
      /** Set a setting in any app's namespace (superuser only) */
      "set/su": command({
        input: v.object({
          appId: v.string(),
          key: v.string(),
          value: v.string(),
        }),
        permission: "superuser",
        handle: ({ appId, key, value }) =>
          Effect.gen(function* () {
            settings.assertAccess(appId, key);
            yield* settings.set(appId, key, value);
            return { success: true } as { success: boolean };
          }),
      }),
      /** List all settings in any app's namespace (superuser only)
       * @param showRestricted - If true, includes settings the current user cannot access (hidden by default)
       */
      "list/su": command({
        input: v.object({
          appId: v.string(),
          showRestricted: v.optional(v.boolean()),
        }),
        permission: "superuser",
        handle: ({ appId, showRestricted }) =>
          Effect.map(settings.list(appId, showRestricted), (keys) => ({
            keys,
          })),
      }),
      /** Get all settings with values for any app (superuser only)
       * @param showRestricted - If true, includes settings the current user cannot access (hidden by default)
       */
      "get-all/su": command({
        input: v.object({
          appId: v.string(),
          showRestricted: v.optional(v.boolean()),
        }),
        permission: "superuser",
        handle: ({ appId, showRestricted }) =>
          Effect.map(settings.getAll(appId, showRestricted), (values) => ({
            settings: values,
          })),
      }),
      /** Reset a setting for any app (superuser only) */
      "reset/su": command({
        input: v.object({
          appId: v.string(),
          key: v.string(),
          schema: resetSchema,
        }),
        permission: "superuser",
        handle: ({ appId, key, schema }) =>
          Effect.gen(function* () {
            settings.assertAccess(appId, key);
            yield* settings.reset(appId, key, schema);
            return { success: true } as { success: boolean };
          }),
      }),
    },
    events: { changed: settings.changed },
  });
}

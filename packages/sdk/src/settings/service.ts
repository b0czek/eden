import type { SettingsCategory } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEvent } from "../events/event";
import { log } from "../logging";
import { EDEN_SETTINGS_APP_ID } from "./constants";
import type {
  SettingsAuthorization,
  SettingsCatalog,
  SettingsStorage,
} from "./ports";
import { EDEN_SETTINGS_SCHEMA } from "./schema";

interface SettingsDependencies {
  storage: SettingsStorage;
  catalog: SettingsCatalog;
  authorization: SettingsAuthorization;
}

export function createSettings({
  storage,
  catalog,
  authorization,
}: SettingsDependencies) {
  return Effect.gen(function* () {
    const connection = yield* storage.open;
    const changed = yield* Effect.acquireRelease(
      Effect.sync(() =>
        createEvent<{ appId: string; key: string; value: string }>(),
      ),
      (event) => Effect.sync(event.dispose),
    );

    function getSettingDefinition(appId: string, key: string) {
      const schema =
        appId === EDEN_SETTINGS_APP_ID
          ? EDEN_SETTINGS_SCHEMA
          : catalog.getAppSettings(appId);
      for (const category of schema ?? []) {
        const setting = category.settings.find(
          (candidate) => candidate.key === key,
        );
        if (setting) return setting;
      }
      return undefined;
    }

    function get(appId: string, key: string) {
      return Effect.map(connection.read(`${appId}:${key}`), (value) => {
        if (value === undefined)
          return getSettingDefinition(appId, key)?.defaultValue;
        if (typeof value !== "string") {
          log.warn(
            `Non-string value found for key ${key}, converting to string`,
          );
          return String(value);
        }
        return value;
      });
    }

    function set(appId: string, key: string, value: string) {
      // Persistence cannot be aborted once SQLite has accepted the write.
      // Publish the completed write before honoring interruption.
      return Effect.uninterruptible(
        Effect.gen(function* () {
          if (typeof value !== "string")
            yield* Effect.fail(
              new Error(`Value must be a string, got ${typeof value}`),
            );
          yield* connection.write(`${appId}:${key}`, value);
          changed.emit({ appId, key, value });
        }),
      );
    }

    function remove(appId: string, key: string) {
      return connection.remove(`${appId}:${key}`);
    }

    function list(appId: string, showRestricted?: boolean) {
      const prefix = `${appId}:`;
      return Effect.map(connection.keys(), (keys) => {
        const names = keys
          .filter(
            (key): key is string =>
              typeof key === "string" && key.startsWith(prefix),
          )
          .map((key) => key.substring(prefix.length));
        return showRestricted ? names : filterAllowedKeys(appId, names);
      });
    }

    function getAll(appId: string, showRestricted?: boolean) {
      return Effect.gen(function* () {
        const keys =
          appId === EDEN_SETTINGS_APP_ID
            ? (showRestricted
                ? EDEN_SETTINGS_SCHEMA
                : filterSchemaByGrants(EDEN_SETTINGS_SCHEMA)
              ).flatMap((category) =>
                category.settings.map((setting) => setting.key),
              )
            : yield* list(appId, showRestricted);
        const result: Record<string, string> = {};
        for (const key of keys) {
          const value = yield* get(appId, key);
          if (value !== undefined) result[key] = value;
        }
        return result;
      });
    }

    function reset(appId: string, key: string, schema?: SettingsCategory[]) {
      return Effect.gen(function* () {
        const schemaToUse =
          appId === EDEN_SETTINGS_APP_ID ? EDEN_SETTINGS_SCHEMA : schema;
        const setting = schemaToUse
          ?.flatMap((category) => category.settings)
          .find((candidate) => candidate.key === key);
        if (setting?.defaultValue === undefined)
          return yield* Effect.fail(
            new Error(
              `Cannot reset key "${key}": no default value found in schema`,
            ),
          );
        yield* set(appId, key, setting.defaultValue);
      });
    }

    function canRead(
      ownerAppId: string,
      key: string,
      readerAppId: string,
    ): boolean {
      if (ownerAppId === readerAppId) return true;
      return (
        getSettingDefinition(ownerAppId, key)?.sharedWith?.includes(
          readerAppId,
        ) ?? false
      );
    }

    function assertReadableBy(
      ownerAppId: string,
      key: string,
      readerAppId: string,
    ): void {
      if (ownerAppId === readerAppId) return;
      if (!getSettingDefinition(ownerAppId, key))
        throw new Error(
          `Setting "${key}" does not exist for app "${ownerAppId}"`,
        );
      if (!canRead(ownerAppId, key, readerAppId))
        throw new Error("Caller is not allowed to read this setting");
      assertAccess(ownerAppId, key);
    }

    function resolveGrantKey(appId: string, settingKey: string): string {
      return appId === EDEN_SETTINGS_APP_ID
        ? (getSettingDefinition(appId, settingKey)?.grant ?? settingKey)
        : settingKey;
    }

    function canAccessSetting(appId: string, key: string): boolean {
      return authorization.hasGrant(`settings/${appId}/${key}`);
    }

    function assertAccess(appId: string, key: string): void {
      if (!canAccessSetting(appId, resolveGrantKey(appId, key)))
        throw new Error("User does not have grant to access this setting");
    }

    function filterAllowedKeys(appId: string, keys: string[]): string[] {
      return keys.filter((key) =>
        canAccessSetting(appId, resolveGrantKey(appId, key)),
      );
    }

    function filterSchemaByGrants(
      categories: SettingsCategory[],
    ): SettingsCategory[] {
      return categories
        .map((category) => ({
          ...category,
          settings: category.settings.filter((setting) =>
            canAccessSetting(
              EDEN_SETTINGS_APP_ID,
              setting.grant ?? setting.key,
            ),
          ),
        }))
        .filter((category) =>
          category.view && category.grant
            ? authorization.hasGrant(category.grant)
            : category.settings.length > 0,
        );
    }

    return {
      get,
      set,
      delete: remove,
      list,
      getAll,
      reset,
      canRead,
      assertReadableBy,
      resolveGrantKey,
      assertAccess,
      filterAllowedKeys,
      filterSchemaByGrants,
      changed,
    };
  });
}

export type Settings = Effect.Success<ReturnType<typeof createSettings>>;

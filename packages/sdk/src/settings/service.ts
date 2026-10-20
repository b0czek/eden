import type { SettingsCategory } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import { ExecutionContext } from "../execution/context";
import { log } from "../logging";
import type {
  StorageClosedError,
  StorageReadFailure,
  StorageRemoveFailure,
  StorageWriteFailure,
} from "../storage/errors";
import { EDEN_SETTINGS_APP_ID } from "./constants";
import {
  SettingAccessError,
  SettingDefaultMissingError,
  SettingValueError,
} from "./errors";
import { SettingsCatalog, SettingsStorage } from "./ports";
import { EDEN_SETTINGS_SCHEMA } from "./schema";

export interface Settings {
  get: (
    appId: string,
    key: string,
  ) => Effect.Effect<string | undefined, StorageReadFailure>;
  set: (
    appId: string,
    key: string,
    value: string,
  ) => Effect.Effect<void, StorageWriteFailure | SettingValueError>;
  delete: (
    appId: string,
    key: string,
  ) => Effect.Effect<void, StorageRemoveFailure>;
  list: (
    appId: string,
    showRestricted?: boolean,
  ) => Effect.Effect<string[], StorageClosedError>;
  getAll: (
    appId: string,
    showRestricted?: boolean,
  ) => Effect.Effect<Record<string, string>, StorageReadFailure>;
  reset: (
    appId: string,
    key: string,
    schema?: SettingsCategory[],
  ) => Effect.Effect<
    undefined,
    StorageWriteFailure | SettingValueError | SettingDefaultMissingError
  >;
  canRead: (ownerAppId: string, key: string, readerAppId: string) => boolean;
  assertReadableBy: (
    ownerAppId: string,
    key: string,
    readerAppId: string,
  ) => void;
  resolveGrantKey: (appId: string, settingKey: string) => string;
  assertAccess: (appId: string, key: string) => void;
  filterAllowedKeys: (appId: string, keys: string[]) => string[];
  filterSchemaByGrants: (categories: SettingsCategory[]) => SettingsCategory[];
  changed: Event<{ appId: string; key: string; value: string }>;
}

export const Settings = Context.Service<"eden/Settings", Settings>(
  "eden/Settings",
);

export const SettingsLive = Layer.effect(
  Settings,
  Effect.gen(function* () {
    const connection = yield* SettingsStorage;
    const catalog = yield* SettingsCatalog;
    const authorization = yield* ExecutionContext;
    const changed = yield* scopedEvent<{
      appId: string;
      key: string;
      value: string;
    }>();

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

    function resolveValue(appId: string, key: string, value: unknown) {
      if (value === undefined)
        return getSettingDefinition(appId, key)?.defaultValue;
      if (typeof value !== "string") {
        log.warn(`Non-string value found for key ${key}, converting to string`);
        return String(value);
      }
      return value;
    }

    function get(appId: string, key: string) {
      return Effect.map(connection.read(`${appId}:${key}`), (value) =>
        resolveValue(appId, key, value),
      );
    }

    function set(
      appId: string,
      key: string,
      value: string,
    ): Effect.Effect<void, StorageWriteFailure | SettingValueError> {
      // Persistence cannot be aborted once SQLite has accepted the write.
      // Publish the completed write before honoring interruption.
      return Effect.uninterruptible(
        Effect.gen(function* () {
          if (typeof value !== "string")
            return yield* Effect.fail(
              new SettingValueError({ appId, key, valueType: typeof value }),
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
        if (keys.length === 0) return result;
        const values = yield* connection.readMany(
          keys.map((key) => `${appId}:${key}`),
        );
        for (const [index, key] of keys.entries()) {
          const value = resolveValue(appId, key, values[index]);
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
            new SettingDefaultMissingError({ appId, key }),
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
        throw new SettingAccessError({
          appId: ownerAppId,
          key,
          readerAppId,
          reason: "missing",
        });
      if (!canRead(ownerAppId, key, readerAppId))
        throw new SettingAccessError({
          appId: ownerAppId,
          key,
          readerAppId,
          reason: "reader",
        });
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
        throw new SettingAccessError({ appId, key, reason: "grant" });
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
  }),
);

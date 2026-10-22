import type { SettingsCategory } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type {
  StorageClosedError,
  StorageReadFailure,
  StorageRemoveFailure,
  StorageWriteFailure,
} from "../../platform/storage/errors";

export interface SettingsStorage {
  read(key: string): Effect.Effect<unknown, StorageReadFailure>;
  /** Values follow key order; missing values retain their undefined positions. */
  readMany(
    keys: string[],
  ): Effect.Effect<readonly unknown[], StorageReadFailure>;
  write(key: string, value: string): Effect.Effect<void, StorageWriteFailure>;
  remove(key: string): Effect.Effect<void, StorageRemoveFailure>;
  keys(): Effect.Effect<readonly unknown[], StorageClosedError>;
}
export const SettingsStorage = Context.Service<
  "eden/SettingsStorage",
  SettingsStorage
>("eden/SettingsStorage");

export interface SettingsCatalog {
  getAppSettings(appId: string): SettingsCategory[] | undefined;
}
export const SettingsCatalog = Context.Service<
  "eden/SettingsCatalog",
  SettingsCatalog
>("eden/SettingsCatalog");

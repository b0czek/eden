import type { SettingsCategory } from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type * as Scope from "effect/Scope";

export interface SettingsConnection {
  read(key: string): Effect.Effect<unknown, Error>;
  /** Values follow key order; missing values retain their undefined positions. */
  readMany(keys: string[]): Effect.Effect<readonly unknown[], Error>;
  write(key: string, value: string): Effect.Effect<void, Error>;
  remove(key: string): Effect.Effect<void, Error>;
  keys(): Effect.Effect<readonly unknown[], Error>;
}

export interface SettingsStorage {
  readonly open: Effect.Effect<SettingsConnection, Error, Scope.Scope>;
}

export interface SettingsCatalog {
  getAppSettings(appId: string): SettingsCategory[] | undefined;
}

export interface SettingsAuthorization {
  hasGrant(grant: string): boolean;
}

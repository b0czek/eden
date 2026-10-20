import type { WallpaperConfig } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { SettingValueError } from "../settings/errors";
import type {
  StorageReadFailure,
  StorageWriteFailure,
} from "../storage/errors";

export interface AppearanceSettings {
  readWallpaper(): Effect.Effect<string | undefined, StorageReadFailure>;
  saveWallpaper(
    config: WallpaperConfig,
  ): Effect.Effect<void, StorageWriteFailure | SettingValueError>;
}
export const AppearanceSettings = Context.Service<
  "eden/AppearanceSettings",
  AppearanceSettings
>("eden/AppearanceSettings");

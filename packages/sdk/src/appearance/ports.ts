import type { WallpaperConfig } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface AppearanceSettings {
  readWallpaper(): Effect.Effect<string | undefined, Error>;
  saveWallpaper(config: WallpaperConfig): Effect.Effect<void, Error>;
}

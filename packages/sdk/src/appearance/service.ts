import type { WallpaperConfig, WallpaperPreset } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { createEvent } from "../events/event";
import { log } from "../logging";
import type { AppearanceSettings } from "./ports";
import {
  DEFAULT_WALLPAPER_PRESET,
  resolveWallpaper,
  WALLPAPER_PRESETS,
} from "./presets";
import { wallpaperConfigSchema } from "./schemas";

interface AppearanceDependencies {
  settings: AppearanceSettings;
}

export function createAppearance({ settings }: AppearanceDependencies) {
  return Effect.gen(function* () {
    const wallpaperChanged = createEvent<WallpaperPreset>();
    let currentWallpaper = DEFAULT_WALLPAPER_PRESET;

    yield* Effect.addFinalizer(() => Effect.sync(wallpaperChanged.dispose));

    function initialize() {
      return Effect.gen(function* () {
        const savedWallpaper = yield* settings.readWallpaper();
        if (savedWallpaper) {
          try {
            currentWallpaper = resolveWallpaper(
              v.parse(wallpaperConfigSchema, JSON.parse(savedWallpaper)),
            );
          } catch (error) {
            log.error("Failed to parse saved wallpaper config", error);
          }
        }
      });
    }

    function setWallpaper(config: WallpaperConfig) {
      // The store cannot cancel a write already in progress. Finish
      // publishing that commit before honoring interruption.
      return Effect.gen(function* () {
        yield* settings.saveWallpaper(config);
        const resolved = resolveWallpaper(config);
        currentWallpaper = resolved;
        wallpaperChanged.emit(resolved);
      }).pipe(Effect.uninterruptible);
    }

    function getWallpaper() {
      return Effect.sync(() => currentWallpaper);
    }

    function getPresets() {
      return {
        solid: WALLPAPER_PRESETS.filter((preset) => preset.type === "color"),
        gradients: WALLPAPER_PRESETS.filter(
          (preset) => preset.type === "gradient",
        ),
      };
    }

    return {
      initialize,
      setWallpaper,
      getWallpaper,
      getPresets,
      wallpaperChanged,
    };
  });
}

export type Appearance = Effect.Success<ReturnType<typeof createAppearance>>;

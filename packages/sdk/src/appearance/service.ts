import type { WallpaperConfig, WallpaperPreset } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as v from "valibot";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import { log } from "../logging/logger";
import type { SettingValueError } from "../settings/errors";
import type {
  StorageReadFailure,
  StorageWriteFailure,
} from "../storage/errors";
import { AppearanceSettings } from "./ports";
import {
  DEFAULT_WALLPAPER_PRESET,
  resolveWallpaper,
  WALLPAPER_PRESETS,
} from "./presets";
import { wallpaperConfigSchema } from "./schemas";

export interface Appearance {
  initialize: () => Effect.Effect<void, StorageReadFailure>;
  setWallpaper: (
    config: WallpaperConfig,
  ) => Effect.Effect<void, StorageWriteFailure | SettingValueError>;
  getWallpaper: () => Effect.Effect<WallpaperPreset>;
  getPresets: () => { solid: WallpaperPreset[]; gradients: WallpaperPreset[] };
  wallpaperChanged: Event<WallpaperPreset>;
}

export const Appearance = Context.Service<"eden/Appearance", Appearance>(
  "eden/Appearance",
);
export const AppearanceLive = Layer.effect(
  Appearance,
  Effect.gen(function* () {
    const settings = yield* AppearanceSettings;
    const wallpaperChanged = yield* scopedEvent<WallpaperPreset>();
    let currentWallpaper = DEFAULT_WALLPAPER_PRESET;

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
  }),
);

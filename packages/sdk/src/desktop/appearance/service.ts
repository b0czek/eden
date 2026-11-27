import type {
  AppearanceState,
  EdenTheme,
  WallpaperConfig,
  WallpaperPreset,
} from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as v from "valibot";
import type { Event } from "../../core/events/event";
import { listen, scopedEvent } from "../../core/events/scoped";
import { EDEN_SETTINGS_APP_ID } from "../../core/settings/constants";
import type { SettingValueError } from "../../core/settings/errors";
import { Settings } from "../../core/settings/service";
import { log } from "../../platform/logging/logger";
import { ThemeStatePort } from "../../platform/ports/types";
import type {
  StorageReadFailure,
  StorageWriteFailure,
} from "../../platform/storage/errors";
import { RuntimeConfig } from "../../runtime/inputs";
import { InvalidAppearanceConfig, UnknownTheme } from "./errors";
import {
  defaultWallpaper,
  resolveWallpaper,
  wallpaperPresets,
} from "./presets";
import { wallpaperConfigSchema } from "./schemas";
import {
  createThemeCatalog,
  resolveTheme,
  themeBackgroundColor,
  themeStylesheet,
} from "./themes";

const WALLPAPER_KEY = "appearance.wallpaper";
const THEME_KEY = "appearance.theme";

export interface Appearance {
  initialize: () => Effect.Effect<void, StorageReadFailure>;
  getState: () => AppearanceState;
  /** Built-in and configured themes, with the colors they inherit. */
  getThemes: () => EdenTheme[];
  /** Selects a theme, switching to its color scheme. */
  setTheme: (
    themeId: string,
  ) => Effect.Effect<
    void,
    UnknownTheme | StorageWriteFailure | SettingValueError
  >;
  /** CSS that applies the selected theme; empty when it sets no colors. */
  getThemeStylesheet: () => string;
  /** The color the main window shows before its page paints. */
  getBackgroundColor: () => string;
  setWallpaper: (
    config: WallpaperConfig,
  ) => Effect.Effect<void, StorageWriteFailure | SettingValueError>;
  getWallpaper: () => WallpaperPreset;
  getPresets: () => { solid: WallpaperPreset[]; gradients: WallpaperPreset[] };
  wallpaperChanged: Event<WallpaperPreset>;
  appearanceChanged: Event<AppearanceState>;
}

export const Appearance = Context.Service<"eden/Appearance", Appearance>(
  "eden/Appearance",
);
export const AppearanceLive = Layer.effect(
  Appearance,
  Effect.gen(function* () {
    const settings = yield* Settings;
    const themeState = yield* ThemeStatePort;
    const config = yield* RuntimeConfig;
    const catalog = yield* Effect.try({
      try: () => createThemeCatalog(config.appearance),
      catch: (error) => {
        if (error instanceof InvalidAppearanceConfig) return error;
        throw error;
      },
    });
    const wallpaperChanged = yield* scopedEvent<WallpaperPreset>();
    const appearanceChanged = yield* scopedEvent<AppearanceState>();
    let theme = catalog.defaultTheme;
    let wallpaperConfig: WallpaperConfig | undefined;
    let currentWallpaper = defaultWallpaper(theme.colorScheme);

    function getState(): AppearanceState {
      return { theme: resolveTheme(theme), colorScheme: theme.colorScheme };
    }

    function resolveCurrentWallpaper() {
      currentWallpaper = wallpaperConfig
        ? resolveWallpaper(wallpaperConfig, theme.colorScheme)
        : defaultWallpaper(theme.colorScheme);
    }

    function parseWallpaper(value: string) {
      try {
        return v.parse(wallpaperConfigSchema, JSON.parse(value));
      } catch (error) {
        log.error("Failed to parse saved wallpaper config", error);
        return undefined;
      }
    }

    function initialize() {
      return Effect.gen(function* () {
        const themeId = yield* settings.get(EDEN_SETTINGS_APP_ID, THEME_KEY);
        // A theme removed from the configuration falls back to the default.
        theme = (themeId && catalog.find(themeId)) || catalog.defaultTheme;
        themeState.setColorScheme(theme.colorScheme);

        const savedWallpaper = yield* settings.get(
          EDEN_SETTINGS_APP_ID,
          WALLPAPER_KEY,
        );
        if (savedWallpaper) wallpaperConfig = parseWallpaper(savedWallpaper);
        resolveCurrentWallpaper();
      });
    }

    function applyTheme(next: EdenTheme) {
      if (next === theme) return;
      const schemeChanged = next.colorScheme !== theme.colorScheme;
      theme = next;
      themeState.setColorScheme(theme.colorScheme);
      appearanceChanged.emit(getState());
      if (schemeChanged) {
        resolveCurrentWallpaper();
        wallpaperChanged.emit(currentWallpaper);
      }
    }

    function applyWallpaper(config: WallpaperConfig) {
      if (JSON.stringify(config) === JSON.stringify(wallpaperConfig)) return;
      wallpaperConfig = config;
      resolveCurrentWallpaper();
      wallpaperChanged.emit(currentWallpaper);
    }

    // Every write to the appearance settings takes effect, including writes
    // that do not use this service.
    yield* listen(settings.changed, ({ appId, key, value }) => {
      if (appId !== EDEN_SETTINGS_APP_ID) return;
      if (key === THEME_KEY) {
        const next = catalog.find(value);
        if (next) applyTheme(next);
        else log.warn(`Ignoring unknown theme "${value}"`);
      } else if (key === WALLPAPER_KEY) {
        const config = parseWallpaper(value);
        if (config) applyWallpaper(config);
      }
    });

    // The store cannot cancel a write already in progress. Each setter
    // finishes publishing its commit before honoring interruption.
    function setTheme(themeId: string) {
      return Effect.gen(function* () {
        const next = catalog.find(themeId);
        if (!next) return yield* new UnknownTheme({ themeId });
        yield* settings.set(EDEN_SETTINGS_APP_ID, THEME_KEY, next.id);
        applyTheme(next);
      }).pipe(Effect.uninterruptible);
    }

    function setWallpaper(config: WallpaperConfig) {
      return Effect.gen(function* () {
        yield* settings.set(
          EDEN_SETTINGS_APP_ID,
          WALLPAPER_KEY,
          JSON.stringify(config),
        );
        applyWallpaper(config);
      }).pipe(Effect.uninterruptible);
    }

    return {
      initialize,
      getState,
      getThemes: () => catalog.themes.map(resolveTheme),
      setTheme,
      getThemeStylesheet: () => themeStylesheet(theme),
      getBackgroundColor: () => themeBackgroundColor(theme),
      setWallpaper,
      getWallpaper: () => currentWallpaper,
      getPresets: () => wallpaperPresets(theme.colorScheme),
      wallpaperChanged,
      appearanceChanged,
    };
  }),
);

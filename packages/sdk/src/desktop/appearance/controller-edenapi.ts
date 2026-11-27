import * as v from "valibot";
import { command, defineController } from "../../core/controllers/controller";
import { wallpaperConfigSchema } from "./schemas";
import type { Appearance } from "./service";

export function createAppearanceController(appearance: Appearance) {
  return defineController("appearance", {
    commands: {
      "set-wallpaper": command({
        input: v.object({ wallpaper: wallpaperConfigSchema }),
        permission: "manage",
        handle: ({ wallpaper }) => appearance.setWallpaper(wallpaper),
      }),
      "get-wallpaper": command({
        handle: () => ({ wallpaper: appearance.getWallpaper() }),
      }),
      "get-presets": command({
        handle: () => appearance.getPresets(),
      }),
      "get-appearance": command({
        handle: () => appearance.getState(),
      }),
      "get-themes": command({
        handle: () => ({ themes: appearance.getThemes() }),
      }),
      "set-theme": command({
        input: v.object({ themeId: v.string() }),
        permission: "manage",
        handle: ({ themeId }) => appearance.setTheme(themeId),
      }),
    },
    events: {
      "wallpaper-changed": appearance.wallpaperChanged,
      "appearance-changed": appearance.appearanceChanged,
    },
  });
}

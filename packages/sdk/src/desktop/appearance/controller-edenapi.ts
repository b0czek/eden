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
    },
    events: { "wallpaper-changed": appearance.wallpaperChanged },
  });
}

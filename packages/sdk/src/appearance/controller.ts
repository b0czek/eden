import type { WallpaperConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { Appearance } from "./service";

const wallpaper: v.GenericSchema<WallpaperConfig> = v.variant("type", [
  v.object({ type: v.literal("preset"), id: v.string() }),
  v.object({ type: v.literal("custom"), value: v.string() }),
]);

export function createAppearanceController(appearance: Appearance) {
  return defineController("appearance", {
    commands: {
      "set-wallpaper": command({
        input: v.object({ wallpaper }),
        permission: "manage",
        handle: ({ wallpaper }) => appearance.setWallpaper(wallpaper),
      }),
      "get-wallpaper": command({
        handle: () =>
          appearance
            .getWallpaper()
            .pipe(Effect.map((wallpaper) => ({ wallpaper }))),
      }),
      "get-presets": command({
        handle: () => appearance.getPresets(),
      }),
    },
    events: { "wallpaper-changed": appearance.wallpaperChanged },
  });
}

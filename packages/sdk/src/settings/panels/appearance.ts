import type {
  SettingsCategory,
  SettingsPanelValue,
  WallpaperConfig,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import { wallpaperConfigSchema } from "../../appearance/schemas";
import { cloneRendererValue } from "../SettingsPanelCodec";
import type { BuiltinPanelModule } from "./types";

export const appearanceSettingsCategory = {
  id: "appearance",
  name: { en: "Appearance", pl: "Wygląd" },
  icon: "image",
  view: "appearance" as const,
  grant: "preset/appearance/manage",
  grantScope: "global",
  settings: [
    {
      key: "appearance.wallpaper",
      label: { en: "Wallpaper", pl: "Tapeta" },
      type: "text",
      description: {
        en: "Choose your desktop background",
        pl: "Wybierz tło pulpitu",
      },
      defaultValue: '{"type":"preset","id":"eden-default"}',
    },
  ],
} satisfies SettingsCategory;

export const appearancePanel: BuiltinPanelModule = {
  kind: "custom",
  category: appearanceSettingsCategory,
  actions: {
    "set-wallpaper": {
      value: {
        type: "object",
        required: true,
        properties: { wallpaper: { type: "object", required: true } },
        additionalProperties: false,
      },
      handler: ({ appearance }, invocation) =>
        Effect.gen(function* () {
          const input = yield* Effect.try(() =>
            v.parse(
              wallpaperConfigSchema,
              (invocation.value as unknown as { wallpaper: WallpaperConfig })
                .wallpaper,
            ),
          );
          yield* appearance.setWallpaper(input);
        }),
    },
  },
  createLoader:
    ({ appearance }) =>
    () =>
      Effect.map(appearance.getWallpaper(), (wallpaper) => ({
        data: cloneRendererValue({
          presets: appearance.getPresets(),
          wallpaper,
        }) as unknown as SettingsPanelValue,
      })),
};

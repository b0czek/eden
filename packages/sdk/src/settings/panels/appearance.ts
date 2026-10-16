import type {
  SettingsCategory,
  SettingsPanelValue,
  WallpaperConfig,
} from "@edenapp/types";
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
      handler: async ({ appearance, effects }, invocation) => {
        const { wallpaper } = invocation.value as unknown as {
          wallpaper: WallpaperConfig;
        };
        await effects.run(appearance.setWallpaper(wallpaper));
      },
    },
  },
  createLoader:
    ({ appearance, effects }) =>
    async () => ({
      data: cloneRendererValue({
        presets: appearance.getPresets(),
        wallpaper: await effects.run(appearance.getWallpaper()),
      }) as unknown as SettingsPanelValue,
    }),
};

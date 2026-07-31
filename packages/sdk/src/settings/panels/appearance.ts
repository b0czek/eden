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
      input: {
        type: "object",
        required: true,
        properties: { wallpaper: { type: "object", required: true } },
        additionalProperties: false,
      },
      handler: async ({ appearanceManager }, input) => {
        const { wallpaper } = input as unknown as {
          wallpaper: WallpaperConfig;
        };
        await appearanceManager.setWallpaper(wallpaper);
      },
    },
  },
  createLoader:
    ({ appearanceManager }) =>
    async () => ({
      data: cloneRendererValue({
        presets: appearanceManager.getPresets(),
        wallpaper: await appearanceManager.getWallpaper(),
      }) as unknown as SettingsPanelValue,
    }),
};

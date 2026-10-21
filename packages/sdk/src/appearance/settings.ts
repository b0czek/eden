import type { Settings } from "../settings/service";
import type { AppearanceSettings } from "./ports";

export function createAppearanceSettings(
  settings: Pick<Settings, "get" | "set">,
): AppearanceSettings {
  return {
    readWallpaper: () => settings.get("com.eden", "appearance.wallpaper"),
    saveWallpaper: (config) =>
      settings.set("com.eden", "appearance.wallpaper", JSON.stringify(config)),
  };
}

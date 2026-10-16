import * as Effect from "effect/Effect";
import type { SettingsManager } from "../settings/SettingsManager";
import type { AppearanceSettings } from "./ports";

function settingsError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createAppearanceSettings(
  settings: Pick<SettingsManager, "get" | "set">,
): AppearanceSettings {
  return {
    readWallpaper: () =>
      Effect.tryPromise({
        try: () => settings.get("com.eden", "appearance.wallpaper"),
        catch: settingsError,
      }),
    saveWallpaper: (config) =>
      Effect.tryPromise({
        try: () =>
          settings.set(
            "com.eden",
            "appearance.wallpaper",
            JSON.stringify(config),
          ),
        catch: settingsError,
      }),
  };
}

import * as Effect from "effect/Effect";
import type { SettingsManager } from "../settings/SettingsManager";
import type { I18nSettings } from "./ports";

/** Translate persisted settings into the localization domain's capabilities. */
export function createI18nSettings(
  settings: Pick<SettingsManager, "get" | "on">,
): I18nSettings {
  return {
    readLocale: () =>
      Effect.tryPromise({
        try: () => settings.get("com.eden", "general.locale"),
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      }),
    localeChanged: {
      on: (listener) =>
        settings.on("changed", ({ key, value }) => {
          if (key === "general.locale") return listener({ locale: value });
        }),
    },
  };
}

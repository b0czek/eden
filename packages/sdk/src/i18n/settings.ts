import type { Settings } from "../settings/service";
import type { I18nSettings } from "./ports";

/** Translate persisted settings into the localization domain's capabilities. */
export function createI18nSettings(
  settings: Pick<Settings, "get" | "changed">,
): I18nSettings {
  return {
    readLocale: () => settings.get("com.eden", "general.locale"),
    localeChanged: {
      on: (listener) =>
        settings.changed.on(({ key, value }) => {
          if (key === "general.locale") return listener({ locale: value });
        }),
    },
  };
}

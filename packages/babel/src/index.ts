import i18next, { type InitOptions, type i18n } from "i18next";

export interface EdenI18nConfig {
  debug?: boolean;
  fallbackLng?: string;
  resources?: InitOptions["resources"];
}

/**
 * Creates and initializes an i18next instance for Eden apps.
 * Merges app-specific resources with common translations fetched from system.
 */
export async function createEdenI18n(
  config: EdenI18nConfig = {},
): Promise<i18n> {
  const instance = i18next.createInstance();

  // Basic structure with app resources
  const resources = config.resources || {};

  // Initialize with app resources first
  await instance.init({
    lng: "en",
    fallbackLng: config.fallbackLng || "en",
    debug: config.debug || false,
    resources,
    interpolation: {
      escapeValue: false,
      // Eden locale strings use single-brace placeholders, e.g. "{name}".
      prefix: "{",
      suffix: "}",
    },
    partialBundledLanguages: true,
  });

  return instance;
}

/**
 * Helper to fetch common translations from system and add them to the instance.
 */
export async function loadCommonTranslations(instance: i18n, locale: string) {
  try {
    // @ts-expect-error
    const edenAPI = window.edenAPI;
    if (!edenAPI) return;

    const result = await edenAPI.shellCommand("i18n/get-common", { locale });
    if (result?.translations) {
      // Merge into the default 'translation' namespace so t("common.ok") works
      instance.addResourceBundle(
        locale,
        "translation",
        result.translations,
        true,
        true,
      );
    }
  } catch (e) {
    console.error("Failed to load common translations", e);
  }
}

/**
 * Get a localized value from a string or localized object.
 *
 * @param value - The value to localize (string or { en: "Files", pl: "Pliki" })
 * @param currentLocale - The current locale (defaults to "en")
 * @returns The localized string
 */
export function getLocalizedValue(
  value: string | Record<string, string> | undefined,
  currentLocale: string = "en",
): string {
  if (!value) return "";
  if (typeof value === "string") {
    return value;
  }
  return value[currentLocale] || value.en || Object.values(value)[0] || "";
}

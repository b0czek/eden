import i18next, { i18n, InitOptions } from "i18next";

export interface EdenI18nConfig {
  debug?: boolean;
  fallbackLng?: string;
  resources?: InitOptions["resources"];
}

/**
 * Creates and initializes an i18next instance for Eden apps.
 * Merges app-specific resources with common translations fetched from system.
 */
export async function createEdenI18n(config: EdenI18nConfig = {}): Promise<i18n> {
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
    },
    partialBundledLanguages: true
  });

  return instance;
}

/**
 * Helper to fetch common translations from system and add them to the instance.
 */
export async function loadCommonTranslations(instance: i18n, locale: string) {
    try {
        // @ts-ignore
        const edenAPI = window.edenAPI;
        if (!edenAPI) return;

        const result = await edenAPI.shellCommand("i18n/get-common", { locale });
        if (result?.translations) {
            // Merge into the default 'translation' namespace so t("common.ok") works
            instance.addResourceBundle(locale, "translation", result.translations, true, true);
        }
    } catch (e) {
        console.error("Failed to load common translations", e);
    }
}


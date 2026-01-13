import i18next, { i18n, InitOptions } from "i18next";
import type { AppManifest } from "@edenapp/types";

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

/**
 * Get the localized name of an app manifest.
 * Handles both simple string names and locale-specific name objects.
 * 
 * @param manifest - The app manifest or object with a name property
 * @param currentLocale - The current locale (defaults to "en" if not provided)
 * @returns The localized app name
 */
export function getLocalizedAppName(
    manifest: { name: AppManifest["name"] },
    currentLocale: string = "en"
): string {
    if (typeof manifest.name === "string") {
        return manifest.name;
    }
    return manifest.name[currentLocale] || manifest.name["en"] || Object.values(manifest.name)[0];
}


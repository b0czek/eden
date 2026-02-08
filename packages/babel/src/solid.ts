import {
  type Accessor,
  createResource,
  createRoot,
  createSignal,
  onCleanup,
  type Setter,
} from "solid-js";
import {
  createEdenI18n,
  type EdenI18nConfig,
  loadCommonTranslations,
} from "./index.js";
import type { TranslateFn } from "./types.js";

/**
 * SolidJS-specific i18n handle with reactive locale.
 */
export interface EdenI18nHandle<T = Record<string, void>> {
  t: TranslateFn<T>;
  locale: Accessor<string>;
  setLocale: Setter<string>;
  initLocale: () => Promise<void>;
}

/**
 * Setup localization for a SolidJS app with full type safety.
 *
 * The generic parameter should be the merged translations type:
 * ```ts
 * import { en } from "./locales/en";
 * import type { I18nCommonTranslations } from "@edenapp/babel/generated/i18n";
 * import type { InferTranslations } from "@edenapp/babel/types";
 *
 * type AppTranslations = InferTranslations<typeof en> & I18nCommonTranslations;
 *
 * export const { t } = setupI18n<AppTranslations>({ resources });
 * ```
 *
 * @param config Configuration options including resources
 */
export function setupI18n<T extends Record<string, any> = Record<string, void>>(
  config: EdenI18nConfig = {},
): EdenI18nHandle<T> {
  return createRoot(() => {
    const [locale, setLocale] = createSignal("en");

    const [i18nInstance] = createResource(async () => {
      return await createEdenI18n(config);
    });

    const t: TranslateFn<T> = ((key: string, args?: Record<string, any>) => {
      const instance = i18nInstance();
      if (!instance) return key;
      return instance.t(key, { lng: locale(), ...args });
    }) as TranslateFn<T>;

    const updateLocale = async (newLocale: string) => {
      const instance = i18nInstance();
      if (instance) {
        await loadCommonTranslations(instance, newLocale);
        await instance.changeLanguage(newLocale);
      }
      setLocale(newLocale);
    };

    const initLocale = async () => {
      try {
        // @ts-expect-error - access global window
        const edenAPI = window.edenAPI;
        if (!edenAPI) {
          console.warn("Eden API not found, using default locale");
          return;
        }

        // Listen for changes
        const onLocaleChanged = (event: { locale: string }) => {
          updateLocale(event.locale);
        };

        // Register cleanup synchronously before any await
        onCleanup(() => {
          edenAPI.unsubscribe("i18n/locale-changed", onLocaleChanged);
        });

        // Initial load
        const result = await edenAPI.shellCommand("i18n/get-locale", {});

        if (result?.locale) {
          await updateLocale(result.locale);
        }

        await edenAPI.subscribe("i18n/locale-changed", onLocaleChanged);
      } catch (e) {
        console.error("Failed to load system locale", e);
      }
    };

    return { t, locale, setLocale, initLocale };
  });
}

export { getLocalizedValue } from "./index.js";
// Re-export types and common utilities
export type { InferTranslations } from "./types.js";

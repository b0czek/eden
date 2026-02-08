import type { I18nCommonTranslations } from "@edenapp/babel/generated/i18n";
import { setupI18n } from "@edenapp/babel/solid";
import type { InferTranslations } from "@edenapp/babel/types";
import { en } from "./locales/en";
import { pl } from "./locales/pl";

// Infer app types from the English locale import
type AppTranslations = InferTranslations<typeof en>;

// Merge with common SDK translations
type AllTranslations = I18nCommonTranslations & AppTranslations;

// App specific resources
const resources = {
  en: { translation: en },
  pl: { translation: pl },
};

// Fully typed i18n setup
export const { t, locale, setLocale, initLocale } = setupI18n<AllTranslations>({
  resources,
});

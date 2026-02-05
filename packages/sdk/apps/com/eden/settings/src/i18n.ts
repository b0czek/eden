import type { I18nCommonTranslations } from "@edenapp/babel/generated/i18n";
import { type InferTranslations, setupI18n } from "@edenapp/babel/solid";
import { en } from "./locales/en";
import { pl } from "./locales/pl";

type AppTranslations = InferTranslations<typeof en>;
type AllTranslations = I18nCommonTranslations & AppTranslations;

const resources = {
  en: { translation: en },
  pl: { translation: pl },
};

export const { t, locale, setLocale, initLocale } = setupI18n<AllTranslations>({
  resources,
});

export { getLocalizedValue } from "@edenapp/babel/solid";

import type { RecursiveObject } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEvent } from "../events/event";
import { commonEn } from "./locales/en";
import { commonPl } from "./locales/pl";
import type { I18nSettings } from "./ports";

const CommonTranslations = {
  en: commonEn,
  pl: commonPl,
};

export type CommonTranslationsMap = RecursiveObject<string>;

interface I18nDependencies {
  settings: I18nSettings;
}

export function createI18n({ settings }: I18nDependencies) {
  return Effect.gen(function* () {
    const localeChanged = yield* Effect.acquireRelease(
      Effect.sync(() => createEvent<{ locale: string }>()),
      (event) => Effect.sync(event.dispose),
    );
    yield* Effect.acquireRelease(
      Effect.sync(() => settings.localeChanged.on(localeChanged.emit)),
      (stop) => Effect.sync(stop),
    );

    function getLocale() {
      return Effect.map(settings.readLocale(), (locale) => locale || "en");
    }

    function getCommon(locale: string): {
      translations: RecursiveObject<string>;
    } {
      const validLocale = locale as keyof typeof CommonTranslations;
      return {
        translations: CommonTranslations[validLocale] || CommonTranslations.en,
      };
    }

    return { getLocale, getCommon, localeChanged };
  });
}

export type I18n = Effect.Success<ReturnType<typeof createI18n>>;

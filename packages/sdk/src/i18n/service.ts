import type { RecursiveObject } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import { commonEn } from "./locales/en";
import { commonPl } from "./locales/pl";

export interface I18nSettings {
  readLocale(): Effect.Effect<string | undefined, Error>;
  readonly localeChanged: Pick<Event<{ locale: string }>, "on">;
}

const CommonTranslations = {
  en: commonEn,
  pl: commonPl,
};

export type CommonTranslationsMap = RecursiveObject<string>;

interface I18nDependencies {
  settings: I18nSettings;
}

export const createI18n = Effect.fn(function* ({ settings }: I18nDependencies) {
  const localeChanged = yield* scopedEvent<{ locale: string }>();
  yield* listen(settings.localeChanged, localeChanged.emit);

  const getLocale = Effect.fn(function* () {
    return (yield* settings.readLocale()) || "en";
  });

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

export type I18n = Effect.Success<ReturnType<typeof createI18n>>;

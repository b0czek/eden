import type { RecursiveObject } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import type { StorageReadFailure } from "../storage/errors";
import { commonEn } from "./locales/en";
import { commonPl } from "./locales/pl";

export interface I18n {
  getLocale: () => Effect.Effect<string, StorageReadFailure>;
  getCommon: (locale: string) => { translations: RecursiveObject<string> };
  localeChanged: Event<{ locale: string }>;
}

export const I18n = Context.Service<"eden/I18n", I18n>("eden/I18n");

export interface I18nSettings {
  readLocale(): Effect.Effect<string | undefined, StorageReadFailure>;
  readonly localeChanged: Pick<Event<{ locale: string }>, "on">;
}
export const I18nSettings = Context.Service<"eden/I18nSettings", I18nSettings>(
  "eden/I18nSettings",
);

const CommonTranslations = {
  en: commonEn,
  pl: commonPl,
};

export type CommonTranslationsMap = RecursiveObject<string>;
export const I18nLive = Layer.effect(
  I18n,
  Effect.gen(function* () {
    const settings = yield* I18nSettings;
    const localeChanged = yield* scopedEvent<{ locale: string }>();

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

    yield* listen(settings.localeChanged, localeChanged.emit);

    return { getLocale, getCommon, localeChanged };
  }),
);

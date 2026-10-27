import type { RecursiveObject } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { StorageReadFailure } from "../../platform/storage/errors";
import type { Event } from "../events/event";
import { listen, scopedEvent } from "../events/scoped";
import { EDEN_SETTINGS_APP_ID } from "../settings/constants";
import { Settings } from "../settings/service";
import { commonEn } from "./locales/en";
import { commonPl } from "./locales/pl";

export interface I18n {
  getLocale: () => Effect.Effect<string, StorageReadFailure>;
  getCommon: (locale: string) => { translations: RecursiveObject<string> };
  localeChanged: Event<{ locale: string }>;
}

export const I18n = Context.Service<"eden/I18n", I18n>("eden/I18n");

const CommonTranslations = {
  en: commonEn,
  pl: commonPl,
};

export type CommonTranslationsMap = RecursiveObject<string>;
export const I18nLive = Layer.effect(
  I18n,
  Effect.gen(function* () {
    const settings = yield* Settings;
    const localeChanged = yield* scopedEvent<{ locale: string }>();

    const getLocale = Effect.fn(function* () {
      return (
        (yield* settings.get(EDEN_SETTINGS_APP_ID, "general.locale")) || "en"
      );
    });

    function getCommon(locale: string): {
      translations: RecursiveObject<string>;
    } {
      const validLocale = locale as keyof typeof CommonTranslations;
      return {
        translations: CommonTranslations[validLocale] || CommonTranslations.en,
      };
    }

    yield* listen(settings.changed, ({ key, value }) => {
      if (key === "general.locale") localeChanged.emit({ locale: value });
    });

    return { getLocale, getCommon, localeChanged };
  }),
);

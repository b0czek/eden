import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { I18n } from "./service";

export function createI18nController(i18n: I18n) {
  return defineController("i18n", {
    commands: {
      "get-locale": command({
        handle: () => Effect.map(i18n.getLocale(), (locale) => ({ locale })),
      }),
      "get-common": command({
        input: v.object({ locale: v.string() }),
        handle: ({ locale }) => i18n.getCommon(locale),
      }),
    },
    events: { "locale-changed": i18n.localeChanged },
  });
}

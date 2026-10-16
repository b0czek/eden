import type * as Effect from "effect/Effect";
import type { Event } from "../events/event";

export interface I18nSettings {
  readLocale(): Effect.Effect<string | undefined, Error>;
  readonly localeChanged: Pick<Event<{ locale: string }>, "on">;
}

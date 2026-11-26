import * as eden from "@edenapp/client";
import { createSignal } from "solid-js";
import * as datetime from "./datetime/locales.js";

/** Every string solid-kit components show, grouped by component. */
export interface SolidKitStrings {
  datetime: datetime.DateTimeStrings;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? T[K] : DeepPartial<T[K]>;
};

/** Strings for a locale; any string left out falls back to English. */
export type SolidKitStringsOverride = DeepPartial<SolidKitStrings>;

const builtIn: Record<string, SolidKitStrings> = {
  en: { datetime: datetime.en },
  pl: { datetime: datetime.pl },
};

const [locale, setLocale] = createSignal("en");
const [added, setAdded] = createSignal<Record<string, SolidKitStringsOverride>>(
  {},
);

let following = false;
/** Follow the system locale, once per window; outside Eden, stay on English. */
function follow() {
  if (following) return;
  following = true;
  const update = (event: { locale: string }) => setLocale(event.locale);
  try {
    eden.i18n.getLocale().then(update, () => {});
    eden.i18n.subscribe("locale-changed", update).catch(() => {});
  } catch {
    // Not running in Eden.
  }
}

/** The locale solid-kit components use: the system locale unless set. */
export function solidKitLocale(): string {
  follow();
  return locale();
}

/** Use `value` in place of the system locale, such as an app's own choice. */
export function setSolidKitLocale(value: string) {
  follow();
  setLocale(value);
}

/**
 * Adds or replaces strings for a locale, such as a language solid-kit does
 * not include. Strings already added for the locale are kept.
 */
export function addSolidKitStrings(
  value: string,
  strings: SolidKitStringsOverride,
) {
  setAdded((all) => ({ ...all, [value]: merge(all[value] ?? {}, strings) }));
}

function merge<T extends object>(base: T, over: object | undefined): T {
  if (!over) return base;
  const result: Record<string, unknown> = {
    ...(base as Record<string, unknown>),
  };
  for (const [key, value] of Object.entries(over)) {
    const current = result[key];
    result[key] =
      value &&
      typeof value === "object" &&
      current &&
      typeof current === "object"
        ? merge(current, value)
        : value;
  }
  return result as T;
}

/** The strings for the current locale: "pl-PL" uses "pl", then English. */
export function solidKitStrings(): SolidKitStrings {
  const value = solidKitLocale();
  const language = value.split("-")[0];
  return [
    builtIn[language],
    builtIn[value],
    added()[language],
    added()[value],
  ].reduce<SolidKitStrings>((all, over) => merge(all, over), builtIn.en);
}

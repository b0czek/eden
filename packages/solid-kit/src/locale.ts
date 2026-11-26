import { appI18n } from "@edenapp/babel/solid";
import * as datetime from "./datetime/locales.js";

/** Every string solid-kit components show, grouped by component. */
export interface SolidKitStrings {
  datetime: datetime.DateTimeStrings;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? T[K] : DeepPartial<T[K]>;
};

/**
 * The keys an app can put in its own locale files to replace solid-kit's
 * strings, such as `solidKit.datetime.done`.
 */
export interface SolidKitTranslations {
  solidKit?: DeepPartial<SolidKitStrings>;
}

const builtIn: Record<string, SolidKitStrings> = {
  en: { datetime: datetime.en },
  pl: { datetime: datetime.pl },
};

/** The app's locale from `@edenapp/babel/solid`, or English without one. */
export function solidKitLocale(): string {
  return appI18n()?.locale() ?? "en";
}

/**
 * The strings for the app's locale. Each one is the app's own translation
 * under `solidKit.`, else solid-kit's for that locale or its language, else
 * English. `override` replaces strings for one component.
 */
export function solidKitStrings<G extends keyof SolidKitStrings>(
  group: G,
  override?: DeepPartial<SolidKitStrings[G]>,
): SolidKitStrings[G] {
  const app = appI18n();
  const value = solidKitLocale();
  const own = builtIn[value] ?? builtIn[value.split("-")[0]] ?? builtIn.en;
  const resolve = (
    english: object,
    local: object | undefined,
    over: object | undefined,
    path: string,
  ): object =>
    Object.fromEntries(
      Object.entries(english).map(([key, fallback]) => {
        const localValue = (local as Record<string, unknown> | undefined)?.[
          key
        ];
        const overValue = (over as Record<string, unknown> | undefined)?.[key];
        if (typeof fallback === "object") {
          return [
            key,
            resolve(
              fallback,
              localValue as object | undefined,
              overValue as object | undefined,
              `${path}.${key}`,
            ),
          ];
        }
        return [
          key,
          (overValue as string | undefined) ??
            app?.find(`${path}.${key}`) ??
            (localValue as string | undefined) ??
            fallback,
        ];
      }),
    );
  return resolve(
    builtIn.en[group],
    own[group],
    override,
    `solidKit.${group}`,
  ) as SolidKitStrings[G];
}

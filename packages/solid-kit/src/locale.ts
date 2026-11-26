import { appI18n } from "@edenapp/babel/solid";
import { en, type SolidKitStrings } from "./locales/en.js";
import { pl } from "./locales/pl.js";

export type { SolidKitStrings };

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends string ? T[K] : DeepPartial<T[K]>;
};

/**
 * The keys an app can put in its own locale files to replace solid-kit's
 * strings, such as `solidKit.dialogs.cancel`.
 */
export interface SolidKitTranslations {
  solidKit?: DeepPartial<SolidKitStrings>;
}

const builtIn: Record<string, SolidKitStrings> = { en, pl };

/** The app's locale from `@edenapp/babel/solid`, or English without one. */
export function solidKitLocale(): string {
  return appI18n()?.locale() ?? "en";
}

/**
 * One component's strings for the app's locale. Each is the component's
 * `override`, else the app's translation under `solidKit.`, else solid-kit's
 * for that locale or its language, else English. Read it in a reactive scope
 * to follow locale changes.
 */
export function solidKitStrings<G extends keyof SolidKitStrings>(
  group: G,
  override?: DeepPartial<SolidKitStrings[G]>,
): SolidKitStrings[G] {
  const app = appI18n();
  const value = solidKitLocale();
  const own = builtIn[value] ?? builtIn[value.split("-")[0]] ?? en;
  const resolve = (
    english: object,
    local: object | undefined,
    over: object | undefined,
    path: string,
  ): object =>
    Object.fromEntries(
      Object.entries(english).map(([key, fallback]) => {
        const at = (from: object | undefined) =>
          (from as Record<string, unknown> | undefined)?.[key];
        if (typeof fallback === "object") {
          return [
            key,
            resolve(
              fallback,
              at(local) as object | undefined,
              at(over) as object | undefined,
              `${path}.${key}`,
            ),
          ];
        }
        return [
          key,
          (at(over) as string | undefined) ??
            app?.find(`${path}.${key}`) ??
            (at(local) as string | undefined) ??
            fallback,
        ];
      }),
    );
  return resolve(
    en[group],
    own[group],
    override,
    `solidKit.${group}`,
  ) as SolidKitStrings[G];
}

/** `template` with each `{name}` replaced by its value. */
export function fillString(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? String(values[name]) : match,
  );
}

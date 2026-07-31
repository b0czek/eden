import { getLocalizedValue } from "@edenapp/babel/solid";
import { vi } from "vitest";
import { en } from "../locales/en";

const common = {
  common: {
    loading: "Loading",
  },
};

const translations: Record<string, unknown> = { ...common, ...en };

const translate = (key: string, args?: Record<string, unknown>): string => {
  const value = key
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      translations,
    );
  if (typeof value !== "string") return key;

  return value.replace(/\{([^}]+)\}/g, (_, name: string) =>
    String(args?.[name] ?? `{${name}}`),
  );
};

vi.mock("../i18n", () => ({
  initLocale: async () => undefined,
  locale: () => "en",
  setLocale: () => "en",
  getLocalizedValue,
  t: translate,
}));

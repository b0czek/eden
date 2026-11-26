import type { DateTimeUnit } from "./DateTimeField.js";

interface DateTimeStrings {
  unit: Record<DateTimeUnit, string>;
  earlier: Record<DateTimeUnit, string>;
  later: Record<DateTimeUnit, string>;
  done: string;
}

const en: DateTimeStrings = {
  unit: { day: "Day", hour: "Hour", minute: "Minute" },
  earlier: {
    day: "Earlier day",
    hour: "Earlier hour",
    minute: "Earlier minute",
  },
  later: { day: "Later day", hour: "Later hour", minute: "Later minute" },
  done: "Done",
};

const pl: DateTimeStrings = {
  unit: { day: "Dzień", hour: "Godzina", minute: "Minuta" },
  earlier: {
    day: "Wcześniejszy dzień",
    hour: "Wcześniejsza godzina",
    minute: "Wcześniejsza minuta",
  },
  later: {
    day: "Późniejszy dzień",
    hour: "Późniejsza godzina",
    minute: "Późniejsza minuta",
  },
  done: "Gotowe",
};

const strings: Record<string, DateTimeStrings> = { en, pl };

/** The field's own strings for an Eden locale such as "pl" or "en-GB". */
export const dateTimeStrings = (locale: string): DateTimeStrings =>
  strings[locale] ?? strings[locale.split("-")[0]] ?? en;

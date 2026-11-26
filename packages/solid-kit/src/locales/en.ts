import type { DateTimeUnit } from "../datetime/DateTimeField.js";

/** Every string solid-kit components show, grouped by component. */
export interface SolidKitStrings {
  datetime: {
    unit: Record<DateTimeUnit, string>;
    earlier: Record<DateTimeUnit, string>;
    later: Record<DateTimeUnit, string>;
    done: string;
  };
  dialogs: { ok: string; cancel: string };
  keyboard: { toggle: string };
  notices: { dismiss: string; showMore: string; showLess: string };
  sidebar: { collapse: string; expand: string };
}

export const en: SolidKitStrings = {
  datetime: {
    unit: { day: "Day", hour: "Hour", minute: "Minute" },
    earlier: {
      day: "Earlier day",
      hour: "Earlier hour",
      minute: "Earlier minute",
    },
    later: { day: "Later day", hour: "Later hour", minute: "Later minute" },
    done: "Done",
  },
  dialogs: { ok: "OK", cancel: "Cancel" },
  keyboard: { toggle: "Toggle keyboard" },
  notices: {
    dismiss: "Dismiss",
    showMore: "{count} more",
    showLess: "Show less",
  },
  sidebar: { collapse: "Collapse sidebar", expand: "Expand sidebar" },
};

/** Every string solid-kit components show, grouped by component. */
export interface SolidKitStrings {
  dialogs: { ok: string; cancel: string };
  keyboard: { toggle: string };
  notices: { dismiss: string; showMore: string; showLess: string };
  sidebar: { collapse: string; expand: string };
}

export const en: SolidKitStrings = {
  dialogs: { ok: "OK", cancel: "Cancel" },
  keyboard: { toggle: "Toggle keyboard" },
  notices: {
    dismiss: "Dismiss",
    showMore: "{count} more",
    showLess: "Show less",
  },
  sidebar: { collapse: "Collapse sidebar", expand: "Expand sidebar" },
};

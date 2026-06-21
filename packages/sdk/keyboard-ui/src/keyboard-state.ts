import type { EdenKeyboardState } from "@edenapp/types";

export type ShiftState = "default" | "shift" | "caps";
export type KeyboardLayer = "letters" | "symbols";

export const DEFAULT_KEYBOARD_STATE: EdenKeyboardState = {
  enabled: true,
  visible: false,
  placementMode: "docked",
  bottomInset: 0,
  layout: "text",
  showNumberRow: true,
};

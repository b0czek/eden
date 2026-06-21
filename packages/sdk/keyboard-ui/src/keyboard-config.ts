import type {
  EdenKeyboardLayout,
  EdenKeyboardPlacementMode,
} from "@edenapp/types";
import type { KeyboardLayer, ShiftState } from "./keyboard-state";

const SHIFT_ICON =
  "<svg class='keyboard-action-icon keyboard-shift-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M14 3 25 14.2h-6v10.8H9V14.2H3L14 3Z'/></svg>";

const BACKSPACE_ICON =
  "<svg class='keyboard-action-icon keyboard-backspace-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M11 7h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H11L3 14l8-7Z'/><path d='m14 11 6 6m0-6-6 6'/></svg>";

const ENTER_ICON =
  "<svg class='keyboard-action-icon keyboard-enter-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M23 6v7a5 5 0 0 1-5 5H6'/><path d='m10 14-4 4 4 4'/></svg>";

const DRAG_ICON =
  "<svg class='keyboard-drag-icon' viewBox='0 0 28 28' aria-hidden='true'><circle cx='10' cy='8' r='1.7'/><circle cx='18' cy='8' r='1.7'/><circle cx='10' cy='14' r='1.7'/><circle cx='18' cy='14' r='1.7'/><circle cx='10' cy='20' r='1.7'/><circle cx='18' cy='20' r='1.7'/></svg>";

const buildTextLayout = (
  showNumberRow: boolean,
): { default: string[]; shift: string[]; symbols: string[] } => {
  const defaultRows = showNumberRow
    ? ["1 2 3 4 5 6 7 8 9 0"]
    : ["q w e r t y u i o p"];
  const shiftRows = showNumberRow
    ? ["! @ # $ % ^ & * ( )"]
    : ["Q W E R T Y U I O P"];

  if (showNumberRow) {
    defaultRows.push("q w e r t y u i o p");
    shiftRows.push("Q W E R T Y U I O P");
  }

  const symbols = showNumberRow
    ? [
        "1 2 3 4 5 6 7 8 9 0",
        "@ # $ & * ( ) ' \" /",
        "- + = _ : ; ! ? %",
        "[ ] { } < > \\ | {bksp}",
        "{letters} {drag} , {space} . {enter}",
      ]
    : [
        "1 2 3 4 5 6 7 8 9 0",
        "@ # $ & * ( ) ' \" /",
        "- + = _ : ; ! ? {bksp}",
        "{letters} {drag} , {space} . {enter}",
      ];

  return {
    default: [
      ...defaultRows,
      "a s d f g h j k l",
      "{shift} z x c v b n m {bksp}",
      "{symbols} {drag} , {space} . {enter}",
    ],
    shift: [
      ...shiftRows,
      "A S D F G H J K L",
      "{shift} Z X C V B N M {bksp}",
      "{symbols} {drag} < {space} > {enter}",
    ],
    symbols,
  };
};

const compactBottomTrailingKey = (
  placementMode: EdenKeyboardPlacementMode,
): "{spacer}" | "{drag}" =>
  placementMode === "floating" ? "{drag}" : "{spacer}";

export const buildLayout = (
  layout: EdenKeyboardLayout,
  showNumberRow: boolean,
  placementMode: EdenKeyboardPlacementMode = "docked",
): { default: string[]; shift: string[]; symbols?: string[] } => {
  if (layout === "number") {
    const trailing = compactBottomTrailingKey(placementMode);

    return {
      default: [
        "1 2 3 {bksp}",
        "4 5 6 {close}",
        "7 8 9 {enter}",
        `. 0 - ${trailing}`,
      ],
      shift: [
        "1 2 3 {bksp}",
        "4 5 6 {close}",
        "7 8 9 {enter}",
        `. 0 - ${trailing}`,
      ],
    };
  }

  return buildTextLayout(showNumberRow);
};

export const getDisplay = () => ({
  "{bksp}": BACKSPACE_ICON,
  "{close}": "×",
  "{drag}": DRAG_ICON,
  "{enter}": ENTER_ICON,
  "{letters}": "ABC",
  "{shift}": SHIFT_ICON,
  "{space}": "<span class='keyboard-space-label' aria-hidden='true'></span>",
  "{symbols}": "?123",
});

export const getLayoutName = (
  shiftState: ShiftState,
  keyboardLayer: KeyboardLayer,
): "default" | "shift" | "symbols" =>
  keyboardLayer === "symbols"
    ? "symbols"
    : shiftState === "default"
      ? "default"
      : "shift";

export const getButtonTheme = (
  shiftState: ShiftState,
  keyboardLayer: KeyboardLayer,
) => {
  const theme = [];

  if (shiftState === "caps") {
    theme.push({ class: "hg-button-locked", buttons: "{shift}" });
  }

  if (shiftState === "shift") {
    theme.push({ class: "hg-button-active", buttons: "{shift}" });
  }

  if (keyboardLayer === "symbols") {
    theme.push({ class: "hg-button-active", buttons: "{letters}" });
  }

  return theme;
};

export const supportsShift = (layout: EdenKeyboardLayout): boolean =>
  layout !== "number";

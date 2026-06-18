import type { EdenKeyboardLayout, EdenKeyboardState } from "@edenapp/types";
import Keyboard from "simple-keyboard";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";

const DEFAULT_KEYBOARD_STATE: EdenKeyboardState = {
  enabled: true,
  visible: false,
  placementMode: "docked",
  bottomInset: 0,
  layout: "text",
  showNumberRow: true,
};

const buildTextRows = (
  layout: EdenKeyboardLayout,
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

  const textSymbols = showNumberRow
    ? [
        "1 2 3 4 5 6 7 8 9 0",
        "@ # $ & * ( ) ' \" /",
        "- + = _ : ; ! ? %",
        "[ ] { } < > \\ | {bksp}",
        "{letters} , {space} . {enter}",
      ]
    : [
        "1 2 3 4 5 6 7 8 9 0",
        "@ # $ & * ( ) ' \" /",
        "- + = _ : ; ! ? {bksp}",
        "{letters} , {space} . {enter}",
      ];

  const emailSymbols = showNumberRow
    ? [
        "1 2 3 4 5 6 7 8 9 0",
        "@ # $ _ & - + ( ) /",
        "* \" ' : ; ! ? %",
        "[ ] { } < > \\ | {bksp}",
        "{letters} . {space} , {enter}",
      ]
    : [
        "1 2 3 4 5 6 7 8 9 0",
        "@ # $ _ & - + ( ) /",
        "* \" ' : ; ! ? {bksp}",
        "{letters} . {space} , {enter}",
      ];

  const urlSymbols = showNumberRow
    ? [
        "1 2 3 4 5 6 7 8 9 0",
        "/ : . - _ ~ ? & = +",
        "# % @ ! ' \" ( )",
        "[ ] { } < > \\ | {bksp}",
        "{letters} / {space} . {enter}",
      ]
    : [
        "1 2 3 4 5 6 7 8 9 0",
        "/ : . - _ ~ ? & = +",
        "# % @ ! ' \" ( ) {bksp}",
        "{letters} / {space} . {enter}",
      ];

  if (layout === "email") {
    return {
      default: [
        ...defaultRows,
        "a s d f g h j k l @",
        "{shift} z x c v b n m _ - {bksp}",
        "{symbols} . {space} , {enter}",
      ],
      shift: [
        ...shiftRows,
        "A S D F G H J K L @",
        "{shift} Z X C V B N M _ - {bksp}",
        "{symbols} . {space} , {enter}",
      ],
      symbols: emailSymbols,
    };
  }

  if (layout === "url") {
    return {
      default: [
        ...defaultRows,
        "a s d f g h j k l /",
        "{shift} z x c v b n m - / {bksp}",
        "{symbols} . {space} , {enter}",
      ],
      shift: [
        ...shiftRows,
        "A S D F G H J K L /",
        "{shift} Z X C V B N M - / {bksp}",
        "{symbols} . {space} , {enter}",
      ],
      symbols: urlSymbols,
    };
  }

  return {
    default: [
      ...defaultRows,
      "a s d f g h j k l",
      "{shift} z x c v b n m {bksp}",
      "{symbols} , {space} . {enter}",
    ],
    shift: [
      ...shiftRows,
      "A S D F G H J K L",
      "{shift} Z X C V B N M {bksp}",
      "{symbols} < {space} > {enter}",
    ],
    symbols: textSymbols,
  };
};

const buildLayout = (
  layout: EdenKeyboardLayout,
  showNumberRow: boolean,
): { default: string[]; shift: string[]; symbols?: string[] } => {
  if (layout === "number") {
    return {
      default: ["1 2 3 {bksp}", "4 5 6 {close}", "7 8 9", ". 0 - {enter}"],
      shift: ["1 2 3 {bksp}", "4 5 6 {close}", "7 8 9", ". 0 - {enter}"],
    };
  }

  if (layout === "tel") {
    return {
      default: ["1 2 3 {bksp}", "4 5 6 {close}", "7 8 9", "* 0 # + {enter}"],
      shift: ["1 2 3 {bksp}", "4 5 6 {close}", "7 8 9", "* 0 # + {enter}"],
    };
  }

  return buildTextRows(layout, showNumberRow);
};

type ShiftState = "default" | "shift" | "caps";
type KeyboardLayer = "letters" | "symbols";

const SHIFT_ICON =
  "<svg class='keyboard-action-icon keyboard-shift-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M14 3 25 14.2h-6v10.8H9V14.2H3L14 3Z'/></svg>";

const BACKSPACE_ICON =
  "<svg class='keyboard-action-icon keyboard-backspace-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M11 7h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H11L3 14l8-7Z'/><path d='m14 11 6 6m0-6-6 6'/></svg>";

const ENTER_ICON =
  "<svg class='keyboard-action-icon keyboard-enter-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M23 6v7a5 5 0 0 1-5 5H6'/><path d='m10 14-4 4 4 4'/></svg>";

const getDisplay = () => ({
  "{bksp}": BACKSPACE_ICON,
  "{close}": "×",
  "{enter}": ENTER_ICON,
  "{letters}": "ABC",
  "{shift}": SHIFT_ICON,
  "{space}": "<span class='keyboard-space-label' aria-hidden='true'></span>",
  "{symbols}": "?123",
});

const getLayoutName = (
  shiftState: ShiftState,
  keyboardLayer: KeyboardLayer,
): "default" | "shift" | "symbols" =>
  keyboardLayer === "symbols"
    ? "symbols"
    : shiftState === "default"
      ? "default"
      : "shift";

const getButtonTheme = (
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

const supportsShift = (layout: EdenKeyboardLayout): boolean =>
  layout !== "number" && layout !== "tel";

export default function App() {
  let keyboard: Keyboard | undefined;
  const [keyboardLayer, setKeyboardLayer] =
    createSignal<KeyboardLayer>("letters");
  const [shiftState, setShiftState] = createSignal<ShiftState>("default");
  const [keyboardState, setKeyboardState] = createSignal<EdenKeyboardState>(
    DEFAULT_KEYBOARD_STATE,
  );

  const toggleShift = () => {
    if (!supportsShift(keyboardState().layout)) {
      return;
    }

    setShiftState((current) => {
      if (current === "default") {
        return "shift";
      }

      if (current === "shift") {
        return "caps";
      }

      return "default";
    });
  };

  const sendText = async (text: string) => {
    await window.edenKeyboard.sendAction({
      type: "insertText",
      text,
    });
  };

  const handleKeyPress = async (button: string) => {
    switch (button) {
      case "{close}":
        await window.edenKeyboard.hide();
        return;
      case "{shift}":
        toggleShift();
        return;
      case "{symbols}":
        setKeyboardLayer("symbols");
        setShiftState("default");
        return;
      case "{letters}":
        setKeyboardLayer("letters");
        return;
      case "{bksp}":
        await window.edenKeyboard.sendAction({ type: "backspace" });
        return;
      case "{enter}":
        await window.edenKeyboard.sendAction({ type: "enter" });
        return;
      case "{space}":
        await sendText(" ");
        return;
      default:
        await sendText(button);
        if (shiftState() === "shift" && supportsShift(keyboardState().layout)) {
          setShiftState("default");
        }
    }
  };

  onMount(() => {
    keyboard = new Keyboard(".simple-keyboard", {
      layout: buildLayout(
        keyboardState().layout,
        keyboardState().showNumberRow,
      ),
      layoutName: getLayoutName(shiftState(), keyboardLayer()),
      display: getDisplay(),
      buttonTheme: getButtonTheme(shiftState(), keyboardLayer()),
      theme: "hg-theme-default eden-osk-theme",
      physicalKeyboardHighlight: false,
      useButtonTag: true,
      onKeyPress: (button) => {
        void handleKeyPress(button);
      },
    });

    const unsubscribe = window.edenKeyboard.onStateChanged?.((state) => {
      setKeyboardState(state);
      if (!supportsShift(state.layout)) {
        setShiftState("default");
        setKeyboardLayer("letters");
      }
    });

    onCleanup(() => {
      unsubscribe?.();
    });
  });

  onCleanup(() => {
    keyboard?.destroy();
  });

  createEffect(() => {
    const state = keyboardState();
    const nextShiftState = supportsShift(state.layout)
      ? shiftState()
      : "default";
    const nextKeyboardLayer = supportsShift(state.layout)
      ? keyboardLayer()
      : "letters";

    keyboard?.setOptions({
      layout: buildLayout(state.layout, state.showNumberRow),
      layoutName: getLayoutName(nextShiftState, nextKeyboardLayer),
      display: getDisplay(),
      buttonTheme: getButtonTheme(nextShiftState, nextKeyboardLayer),
    });
  });

  return (
    <div
      class="keyboard-shell"
      data-layout={keyboardState().layout}
      data-placement={keyboardState().placementMode}
    >
      <div class="keyboard-drag-handle" role="presentation" aria-hidden="true">
        drag
      </div>
      <div class="keyboard-body">
        <div class="simple-keyboard" />
      </div>
    </div>
  );
}

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
): { default: string[]; shift: string[] } => {
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

  if (layout === "email") {
    return {
      default: [
        ...defaultRows,
        "a s d f g h j k l @",
        "{shift} z x c v b n m _ - {bksp}",
        ". {space} , {enter}",
      ],
      shift: [
        ...shiftRows,
        "A S D F G H J K L @",
        "{shift} Z X C V B N M _ - {bksp}",
        ". {space} , {enter}",
      ],
    };
  }

  if (layout === "url") {
    return {
      default: [
        ...defaultRows,
        "a s d f g h j k l /",
        "{shift} z x c v b n m - / {bksp}",
        ". {space} , {enter}",
      ],
      shift: [
        ...shiftRows,
        "A S D F G H J K L /",
        "{shift} Z X C V B N M - / {bksp}",
        ". {space} , {enter}",
      ],
    };
  }

  return {
    default: [
      ...defaultRows,
      "a s d f g h j k l",
      "{shift} z x c v b n m {bksp}",
      ", {space} . {enter}",
    ],
    shift: [
      ...shiftRows,
      "A S D F G H J K L",
      "{shift} Z X C V B N M {bksp}",
      "< {space} > {enter}",
    ],
  };
};

const buildLayout = (
  layout: EdenKeyboardLayout,
  showNumberRow: boolean,
): { default: string[]; shift: string[] } => {
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

const SHIFT_ICON =
  "<svg class='keyboard-shift-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M14 3 25 14.2h-6v10.8H9V14.2H3L14 3Z'/></svg>";

const getDisplay = () => ({
  "{bksp}": "⌫",
  "{close}": "×",
  "{enter}": "↵",
  "{shift}": SHIFT_ICON,
  "{space}": "␣",
});

const getLayoutName = (shiftState: ShiftState): "default" | "shift" =>
  shiftState === "default" ? "default" : "shift";

const getButtonTheme = (shiftState: ShiftState) => {
  if (shiftState === "caps") {
    return [{ class: "hg-button-locked", buttons: "{shift}" }];
  }

  if (shiftState === "shift") {
    return [{ class: "hg-button-active", buttons: "{shift}" }];
  }

  return [];
};

const supportsShift = (layout: EdenKeyboardLayout): boolean =>
  layout !== "number" && layout !== "tel";

export default function App() {
  let keyboard: Keyboard | undefined;
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
      layoutName: getLayoutName(shiftState()),
      display: getDisplay(),
      buttonTheme: getButtonTheme(shiftState()),
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

    keyboard?.setOptions({
      layout: buildLayout(state.layout, state.showNumberRow),
      layoutName: getLayoutName(nextShiftState),
      display: getDisplay(),
      buttonTheme: getButtonTheme(nextShiftState),
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

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
    ? ["1 2 3 4 5 6 7 8 9 0 {bksp} {close}"]
    : ["q w e r t y u i o p {bksp} {close}"];
  const shiftRows = showNumberRow
    ? ["! @ # $ % ^ & * ( ) {bksp} {close}"]
    : ["Q W E R T Y U I O P {bksp} {close}"];

  if (showNumberRow) {
    defaultRows.push("q w e r t y u i o p");
    shiftRows.push("Q W E R T Y U I O P");
  }

  if (layout === "email") {
    return {
      default: [
        ...defaultRows,
        "a s d f g h j k l @ {enter}",
        "{shift} z x c v b n m . _ -",
        "{space}",
      ],
      shift: [
        ...shiftRows,
        "A S D F G H J K L @ {enter}",
        "{shift} Z X C V B N M . _ -",
        "{space}",
      ],
    };
  }

  if (layout === "url") {
    return {
      default: [
        ...defaultRows,
        "a s d f g h j k l / {enter}",
        "{shift} z x c v b n m . - /",
        "{space}",
      ],
      shift: [
        ...shiftRows,
        "A S D F G H J K L / {enter}",
        "{shift} Z X C V B N M . - /",
        "{space}",
      ],
    };
  }

  return {
    default: [
      ...defaultRows,
      "a s d f g h j k l {enter}",
      "{shift} z x c v b n m , .",
      "{space}",
    ],
    shift: [
      ...shiftRows,
      "A S D F G H J K L {enter}",
      "{shift} Z X C V B N M < >",
      "{space}",
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

const getEnterLabel = (state: EdenKeyboardState): string => {
  const enterKeyHint = state.target?.enterKeyHint;
  if (enterKeyHint) {
    return enterKeyHint.charAt(0).toUpperCase() + enterKeyHint.slice(1);
  }

  if (state.layout === "url") {
    return "Go";
  }

  if (state.target?.inputType === "search") {
    return "Search";
  }

  return state.target?.multiline ? "Return" : "Enter";
};

const getDisplay = (state: EdenKeyboardState) => ({
  "{bksp}": "Bksp",
  "{close}": "Hide",
  "{enter}": getEnterLabel(state),
  "{shift}": "Shift",
  "{space}": "Space",
});

const supportsShift = (layout: EdenKeyboardLayout): boolean =>
  layout !== "number" && layout !== "tel";

export default function App() {
  let keyboard: Keyboard | undefined;
  const [layoutName, setLayoutName] = createSignal<"default" | "shift">(
    "default",
  );
  const [keyboardState, setKeyboardState] = createSignal<EdenKeyboardState>(
    DEFAULT_KEYBOARD_STATE,
  );

  const toggleShift = () => {
    if (!supportsShift(keyboardState().layout)) {
      return;
    }

    setLayoutName(layoutName() === "default" ? "shift" : "default");
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
        if (layoutName() === "shift" && supportsShift(keyboardState().layout)) {
          setLayoutName("default");
        }
    }
  };

  onMount(() => {
    keyboard = new Keyboard(".simple-keyboard", {
      layout: buildLayout(
        keyboardState().layout,
        keyboardState().showNumberRow,
      ),
      layoutName: layoutName(),
      display: getDisplay(keyboardState()),
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
        setLayoutName("default");
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
    const nextLayoutName = supportsShift(state.layout)
      ? layoutName()
      : "default";

    keyboard?.setOptions({
      layout: buildLayout(state.layout, state.showNumberRow),
      layoutName: nextLayoutName,
      display: getDisplay(state),
    });
  });

  return (
    <div class="keyboard-shell" data-placement={keyboardState().placementMode}>
      <div class="keyboard-drag-handle" role="presentation" aria-hidden="true">
        drag
      </div>
      <div class="keyboard-body">
        <div class="simple-keyboard" />
      </div>
    </div>
  );
}

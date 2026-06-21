import type { EdenKeyboardState } from "@edenapp/types";
import Keyboard from "simple-keyboard";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import {
  buildLayout,
  getButtonTheme,
  getDisplay,
  getLayoutName,
  supportsShift,
} from "./keyboard-config";
import { createKeyboardDragPointerDownHandler } from "./keyboard-drag";
import {
  DEFAULT_KEYBOARD_STATE,
  type KeyboardLayer,
  type ShiftState,
} from "./keyboard-state";

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
      case "{drag}":
        return;
      case "{spacer}":
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
    const handleDragPointerDown = createKeyboardDragPointerDownHandler();

    keyboard = new Keyboard(".simple-keyboard", {
      layout: buildLayout(
        keyboardState().layout,
        keyboardState().showNumberRow,
        keyboardState().placementMode,
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

    document.addEventListener("pointerdown", handleDragPointerDown, true);

    const unsubscribe = window.edenKeyboard.onStateChanged?.((state) => {
      setKeyboardState(state);
      if (!supportsShift(state.layout)) {
        setShiftState("default");
        setKeyboardLayer("letters");
      }
    });

    onCleanup(() => {
      document.removeEventListener("pointerdown", handleDragPointerDown, true);
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
      layout: buildLayout(
        state.layout,
        state.showNumberRow,
        state.placementMode,
      ),
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
      <div class="keyboard-body">
        <div class="simple-keyboard" />
      </div>
    </div>
  );
}

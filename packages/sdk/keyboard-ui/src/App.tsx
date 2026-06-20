import type {
  EdenKeyboardLayout,
  EdenKeyboardPlacementMode,
  EdenKeyboardState,
} from "@edenapp/types";
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

const buildLayout = (
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

type ShiftState = "default" | "shift" | "caps";
type KeyboardLayer = "letters" | "symbols";

const SHIFT_ICON =
  "<svg class='keyboard-action-icon keyboard-shift-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M14 3 25 14.2h-6v10.8H9V14.2H3L14 3Z'/></svg>";

const BACKSPACE_ICON =
  "<svg class='keyboard-action-icon keyboard-backspace-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M11 7h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H11L3 14l8-7Z'/><path d='m14 11 6 6m0-6-6 6'/></svg>";

const ENTER_ICON =
  "<svg class='keyboard-action-icon keyboard-enter-icon' viewBox='0 0 28 28' aria-hidden='true'><path d='M23 6v7a5 5 0 0 1-5 5H6'/><path d='m10 14-4 4 4 4'/></svg>";

const DRAG_ICON =
  "<svg class='keyboard-drag-icon' viewBox='0 0 28 28' aria-hidden='true'><circle cx='10' cy='8' r='1.7'/><circle cx='18' cy='8' r='1.7'/><circle cx='10' cy='14' r='1.7'/><circle cx='18' cy='14' r='1.7'/><circle cx='10' cy='20' r='1.7'/><circle cx='18' cy='20' r='1.7'/></svg>";

const getDisplay = () => ({
  "{bksp}": BACKSPACE_ICON,
  "{close}": "×",
  "{drag}": DRAG_ICON,
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
  layout !== "number";

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

  const handleDragPointerDown = (event: PointerEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.hg-button[data-skbtn="{drag}"]')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    target.setPointerCapture?.(event.pointerId);

    void window.edenKeyboard.startDrag(event.screenX, event.screenY);

    const endDrag = () => {
      target.releasePointerCapture?.(event.pointerId);
      void window.edenKeyboard.endDrag();
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
    };

    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  onMount(() => {
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

import type { EdenKeyboardState } from "@edenapp/types";
import { BiSolidKeyboard } from "solid-icons/bi";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import "./KeyboardButton.css";

export interface KeyboardButtonProps {
  label: string;
  class?: string;
}

const defaultKeyboardState: EdenKeyboardState = {
  enabled: true,
  visible: false,
  placementMode: "docked",
  bottomInset: 0,
  layout: "text",
  showNumberRow: true,
};

export function KeyboardButton(props: KeyboardButtonProps) {
  const [keyboardState, setKeyboardState] =
    createSignal<EdenKeyboardState>(defaultKeyboardState);
  let keyboardVisibleAtPointerDown: boolean | null = null;

  const refreshKeyboardState = async () => {
    try {
      setKeyboardState(await window.edenKeyboard.getState());
    } catch (error) {
      console.error("Failed to load keyboard state:", error);
    }
  };

  const handleToggle = async () => {
    try {
      const shouldHide =
        keyboardVisibleAtPointerDown ?? keyboardState().visible;
      keyboardVisibleAtPointerDown = null;

      if (shouldHide) {
        await window.edenKeyboard.hide();
      } else {
        await window.edenKeyboard.show();
      }
    } catch (error) {
      console.error("Failed to toggle keyboard:", error);
    } finally {
      void refreshKeyboardState();
    }
  };

  const handlePointerDown = () => {
    keyboardVisibleAtPointerDown = keyboardState().visible;
  };

  onMount(() => {
    const unsubscribeKeyboard =
      window.edenKeyboard.onStateChanged?.((state) => {
        setKeyboardState(state);
      }) ?? (() => {});

    onCleanup(unsubscribeKeyboard);
    void refreshKeyboardState();
  });

  return (
    <Show when={keyboardState().enabled}>
      <button
        type="button"
        class={`eden-btn eden-btn-ghost eden-btn-icon eden-keyboard-button ${props.class ?? ""}`}
        classList={{ active: keyboardState().visible }}
        onClick={() => void handleToggle()}
        onPointerDown={handlePointerDown}
        title={props.label}
        aria-label={props.label}
      >
        <BiSolidKeyboard />
      </button>
    </Show>
  );
}

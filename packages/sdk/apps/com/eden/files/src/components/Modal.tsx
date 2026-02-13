import type { Component } from "solid-js";
import { createEffect, type JSX, onCleanup, Show } from "solid-js";

interface ModalProps {
  show: boolean;
  onClose: () => void;
  onConfirm?: () => void;
  title: string;
  size?: "sm" | "md" | "lg";
  children: JSX.Element;
  footer?: JSX.Element;
}

const Modal: Component<ModalProps> = (props) => {
  createEffect(() => {
    if (!props.show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Keep all keyboard interaction scoped to the active dialog.
      e.stopPropagation();

      if (e.key === "Escape") {
        e.preventDefault();
        props.onClose();
        return;
      }

      if (e.key === "Enter" && props.onConfirm) {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") {
          return;
        }

        e.preventDefault();
        props.onConfirm();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() =>
      document.removeEventListener("keydown", handleKeyDown, true),
    );
  });

  const sizeClass = () => {
    switch (props.size) {
      case "sm":
        return "eden-modal-sm";
      case "lg":
        return "eden-modal-lg";
      default:
        return "";
    }
  };

  return (
    <Show when={props.show}>
      <div class="eden-modal-overlay" onClick={props.onClose}>
        <div
          class={`eden-modal ${sizeClass()}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div class="eden-modal-header">
            <h3 class="eden-modal-title">{props.title}</h3>
            <button class="eden-modal-close" onClick={props.onClose}>
              ×
            </button>
          </div>
          <div class="eden-modal-body">{props.children}</div>
          <Show when={props.footer}>
            <div class="eden-modal-footer">{props.footer}</div>
          </Show>
        </div>
      </div>
    </Show>
  );
};

export default Modal;

import type { Accessor, Component, Setter } from "solid-js";
import { createEffect, onCleanup } from "solid-js";
import type {
  CustomDialogRenderContext,
  DialogController,
  DialogRequest,
  DialogSize,
} from "./types.js";

export interface DialogHostProps {
  dialogs: DialogController;
}

const sizeClass = (size: DialogSize) => {
  if (size === "sm") return "eden-modal-sm";
  if (size === "lg") return "eden-modal-lg";
  return "";
};

export const DialogHost: Component<DialogHostProps> = (props) => {
  let primaryActionRef: HTMLButtonElement | undefined;
  let initialFocusRef: HTMLElement | undefined;

  const createRenderContext = (
    dialog: DialogRequest,
  ): CustomDialogRenderContext<unknown, unknown> => {
    return {
      value: dialog.value as Accessor<unknown>,
      setValue: dialog.setValue as Setter<unknown>,
      canSubmit: dialog.canSubmit,
      setCanSubmit: dialog.setCanSubmit,
      submit: (result) => props.dialogs.submit(result),
      cancel: props.dialogs.cancel,
      setPrimaryActionRef: (el) => {
        primaryActionRef = el;
      },
      setInitialFocusRef: (el) => {
        initialFocusRef = el;
      },
    };
  };

  createEffect(() => {
    const current = props.dialogs.active();
    if (!current) return;

    primaryActionRef = undefined;
    initialFocusRef = undefined;

    const previousActive = document.activeElement as HTMLElement | null;

    queueMicrotask(() => {
      const focusTarget = initialFocusRef ?? primaryActionRef;
      focusTarget?.focus?.();

      if (
        current.selectInitialFocusText &&
        focusTarget &&
        "select" in focusTarget &&
        typeof focusTarget.select === "function"
      ) {
        focusTarget.select();
      }
    });

    onCleanup(() => {
      previousActive?.focus?.();
    });
  });

  createEffect(() => {
    const current = props.dialogs.active();
    if (!current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === "Escape" && current.dismissOnEscape) {
        e.preventDefault();
        props.dialogs.cancel();
        return;
      }

      if (e.key === "Enter" && current.onEnter === "submit") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") {
          return;
        }

        e.preventDefault();
        props.dialogs.submit();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() =>
      document.removeEventListener("keydown", handleKeyDown, true),
    );
  });

  return (
    <>
      {props.dialogs.active() && (
        <div
          class="eden-modal-overlay"
          onClick={() => {
            const dialog = props.dialogs.active();
            if (dialog?.dismissOnBackdrop) {
              props.dialogs.cancel();
            }
          }}
        >
          {(() => {
            const dialog = props.dialogs.active();
            if (!dialog) {
              return null;
            }

            const renderContext = createRenderContext(dialog);

            return (
              <div
                class={`eden-modal ${sizeClass(dialog.size)}`}
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
              >
                <div class="eden-modal-header">
                  <h3 class="eden-modal-title">{dialog.title}</h3>
                  <button
                    class="eden-modal-close"
                    onClick={() => props.dialogs.cancel()}
                  >
                    ×
                  </button>
                </div>

                <div class="eden-modal-body">
                  {dialog.message != null && <div>{dialog.message}</div>}
                  {dialog.render?.(renderContext)}
                </div>

                {dialog.footer && (
                  <div class="eden-modal-footer">
                    {dialog.footer(renderContext)}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </>
  );
};

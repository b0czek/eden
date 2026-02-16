import type { Accessor, Component, Setter } from "solid-js";
import { createEffect, onCleanup } from "solid-js";
import { getDialogRuntime } from "./runtimeRegistry.js";
import type { DialogRequest } from "./runtimeTypes.js";
import type {
  CustomDialogRenderContext,
  DialogController,
  DialogSize,
} from "./types.js";

/** Props for the dialogs host component. */
export interface DialogHostProps {
  /** Controller returned by `createDialogs()`. */
  dialogs: DialogController;
}

const sizeClass = (size: DialogSize) => {
  if (size === "sm") return "eden-modal-sm";
  if (size === "lg") return "eden-modal-lg";
  return "";
};

/** Renders local dialog overlays for a dialogs controller instance. */
export const DialogHost: Component<DialogHostProps> = (props) => {
  const dialogs = getDialogRuntime(props.dialogs);
  if (!dialogs) {
    console.error(
      "DialogHost received an unsupported controller. Pass the value returned by createDialogs().",
    );
    return null;
  }

  let primaryActionRef: HTMLButtonElement | undefined;
  let initialFocusRef: HTMLElement | undefined;
  let modalRef: HTMLDivElement | undefined;

  const createRenderContext = (
    dialog: DialogRequest,
  ): CustomDialogRenderContext<unknown, unknown> => {
    return {
      value: dialog.value as Accessor<unknown>,
      setValue: dialog.setValue as Setter<unknown>,
      canSubmit: dialog.canSubmit,
      setCanSubmit: dialog.setCanSubmit,
      submit: (result) => dialogs.submit(result),
      cancel: dialogs.cancel,
      setPrimaryActionRef: (el) => {
        primaryActionRef = el;
      },
      setInitialFocusRef: (el) => {
        initialFocusRef = el;
      },
    };
  };

  createEffect(() => {
    const current = dialogs.active();
    if (!current) return;

    modalRef = undefined;
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
    const current = dialogs.active();
    if (!current) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();

      if (e.key === "Escape" && current.dismissOnEscape) {
        e.preventDefault();
        dialogs.cancel();
        return;
      }

      if (e.key === "Enter" && current.onEnter === "submit") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "TEXTAREA") {
          return;
        }

        e.preventDefault();
        dialogs.submit();
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (!current.dismissOnBackdrop) return;

      const target = e.target as Node | null;
      if (!target || !modalRef) return;

      if (!modalRef.contains(target)) {
        dialogs.cancel();
      }
    };

    document.addEventListener("mousedown", handleMouseDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", handleMouseDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      modalRef = undefined;
    });
  });

  return (
    <>
      {dialogs.active() && (
        <div class="eden-modal-overlay">
          {(() => {
            const dialog = dialogs.active();
            if (!dialog) {
              return null;
            }

            const renderContext = createRenderContext(dialog);

            return (
              <div
                ref={modalRef}
                class={`eden-modal ${sizeClass(dialog.size)}`}
                role="dialog"
                aria-modal="true"
              >
                <div class="eden-modal-header">
                  <h3 class="eden-modal-title">{dialog.title}</h3>
                  <button
                    type="button"
                    class="eden-modal-close"
                    onClick={() => dialogs.cancel()}
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

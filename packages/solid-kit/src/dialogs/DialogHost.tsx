import type { Accessor, Component, Setter } from "solid-js";
import { createEffect } from "solid-js";
import { Dialog } from "../kobalte.js";
import { getDialogRuntime } from "./runtimeRegistry.js";
import type { DialogRequest } from "./runtimeTypes.js";
import type { CustomDialogRenderContext, DialogController } from "./types.js";

/** Props for the dialogs host component. */
export interface DialogHostProps {
  /** Controller returned by `createDialogs()`. */
  dialogs: DialogController;
  /** Accessible label for the built-in close button. Defaults to `"Close"`. */
  closeLabel?: string;
}

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

    primaryActionRef = undefined;
    initialFocusRef = undefined;
  });

  return (
    <Dialog
      open={Boolean(dialogs.active())}
      onOpenChange={(open) => {
        if (!open && dialogs.active()) dialogs.cancel();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay />
        {(() => {
          const dialog = dialogs.active();
          if (!dialog) return null;
          const renderContext = createRenderContext(dialog);

          return (
            <Dialog.Content
              size={dialog.size}
              onEscapeKeyDown={(event) => {
                if (!dialog.dismissOnEscape) {
                  event.preventDefault();
                  return;
                }
                dialogs.cancel();
              }}
              onInteractOutside={(event) => {
                if (!dialog.dismissOnBackdrop) {
                  event.preventDefault();
                  return;
                }
                dialogs.cancel();
              }}
              onKeyDown={(event: KeyboardEvent) => {
                if (event.key !== "Enter" || dialog.onEnter !== "submit") {
                  return;
                }
                if (
                  (event.target as HTMLElement | null)?.tagName === "TEXTAREA"
                ) {
                  return;
                }
                event.preventDefault();
                dialogs.submit();
              }}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                queueMicrotask(() => {
                  const focusTarget = initialFocusRef ?? primaryActionRef;
                  focusTarget?.focus?.();
                  if (
                    dialog.selectInitialFocusText &&
                    focusTarget &&
                    "select" in focusTarget &&
                    typeof focusTarget.select === "function"
                  ) {
                    focusTarget.select();
                  }
                });
              }}
            >
              <div class="eden-modal-header">
                <Dialog.Title>{dialog.title}</Dialog.Title>
                <Dialog.CloseButton aria-label={props.closeLabel ?? "Close"}>
                  ×
                </Dialog.CloseButton>
              </div>

              <div class="eden-modal-body">
                {dialog.message != null && (
                  <Dialog.Description>{dialog.message}</Dialog.Description>
                )}
                {dialog.render?.(renderContext)}
              </div>

              {dialog.footer && (
                <div class="eden-modal-footer">
                  {dialog.footer(renderContext)}
                </div>
              )}
            </Dialog.Content>
          );
        })()}
      </Dialog.Portal>
    </Dialog>
  );
};

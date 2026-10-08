import { createOperation } from "@edenapp/solid-kit";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { createSignal, onCleanup } from "solid-js";
import { t } from "../i18n";

export type SessionAction = "logout" | "poweroff" | "reboot";

export function useSessionTransition(options: { dialogs: DialogController }) {
  const operation = createOperation();
  const [action, setAction] = createSignal<SessionAction>("logout");
  const [error, setError] = createSignal<string>();
  const [confirming, setConfirming] = createSignal(false);
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const request = async (nextAction: SessionAction) => {
    if (disposed || operation.pending() || confirming()) return;
    try {
      if (nextAction !== "logout") {
        setConfirming(true);
        const label =
          nextAction === "poweroff" ? t("shell.poweroff") : t("shell.reboot");
        const confirmed = await options.dialogs.confirm({
          title: label,
          message:
            nextAction === "poweroff"
              ? t("shell.poweroffConfirmation")
              : t("shell.rebootConfirmation"),
          confirmLabel: label,
          cancelLabel: t("common.cancel"),
          tone: nextAction === "poweroff" ? "danger" : "default",
          role: "alertdialog",
        });
        if (!confirmed || disposed) return;
      }

      setAction(nextAction);
      setError(undefined);
      await operation.run(() =>
        nextAction === "logout"
          ? window.edenAPI.shellCommand("session/logout", {})
          : window.edenAPI.shellCommand("system/power", { action: nextAction }),
      );
    } catch (cause) {
      if (disposed) return;
      console.error(`Failed to ${nextAction}:`, cause);
      setAction(nextAction);
      setError(
        cause instanceof Error
          ? cause.message
          : nextAction === "logout"
            ? t("shell.logoutFailed")
            : t("shell.powerActionFailed"),
      );
    } finally {
      setConfirming(false);
    }
  };

  return {
    action,
    error,
    snapshot: operation.snapshot,
    visible: () => operation.pending() || Boolean(error()),
    confirming,
    request,
    retry: () => request(action()),
    dismiss: () => setError(undefined),
  };
}

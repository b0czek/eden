import { OperationStatus } from "@edenapp/solid-kit";
import type { OperationSnapshot } from "@edenapp/types";
import { Show } from "solid-js";
import type { SessionAction } from "../features/useSessionTransition";
import { t } from "../i18n";

interface SessionTransitionOverlayProps {
  action: SessionAction;
  snapshot?: OperationSnapshot;
  error?: string;
  onRetry: () => void | Promise<void>;
  onDismiss: () => void;
}

export default function SessionTransitionOverlay(
  props: SessionTransitionOverlayProps,
) {
  const label = () => {
    switch (props.action) {
      case "logout":
        return t("shell.loggingOut");
      case "reboot":
        return t("shell.restarting");
      case "poweroff":
        return t("shell.poweringOff");
    }
  };

  return (
    <div class="eden-overlay eden-flex-center eden-p-lg">
      <div
        class="eden-card eden-p-lg eden-flex-col eden-gap-md"
        style={{ width: "min(100%, 420px)" }}
      >
        <Show
          when={props.error}
          fallback={
            <OperationStatus
              label={label()}
              snapshot={props.snapshot}
              description={
                props.snapshot?.phase === "waiting-for-operations"
                  ? t("shell.waitingForOperations")
                  : t("shell.closingApps")
              }
            />
          }
        >
          <p role="alert">{props.error}</p>
          <div class="eden-flex eden-gap-sm">
            <button
              type="button"
              class="eden-btn eden-btn-primary"
              onClick={props.onRetry}
            >
              {t("common.retry")}
            </button>
            <button type="button" class="eden-btn" onClick={props.onDismiss}>
              {t("common.close")}
            </button>
          </div>
        </Show>
      </div>
    </div>
  );
}

import { FiX } from "solid-icons/fi";
import { t } from "../i18n";

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
  tone?: "danger" | "warning";
}

export function ErrorBanner(props: ErrorBannerProps) {
  return (
    <div
      class="error-banner"
      classList={{ warning: props.tone === "warning" }}
      role={props.tone === "warning" ? "status" : "alert"}
    >
      <span>{props.message}</span>
      <button
        type="button"
        onClick={props.onDismiss}
        aria-label={t("common.close")}
      >
        <FiX aria-hidden="true" size={16} />
      </button>
    </div>
  );
}

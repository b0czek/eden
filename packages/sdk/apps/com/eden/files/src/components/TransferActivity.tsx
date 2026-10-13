import { formatFileSize } from "@edenapp/files-core";
import { OperationStatus } from "@edenapp/solid-kit";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import type { OperationSnapshot } from "@edenapp/types";
import { FiCopy, FiExternalLink, FiMove, FiTrash2, FiX } from "solid-icons/fi";
import { Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import type { FileOperationProgress } from "../features/useFileTransfers";
import { t } from "../i18n";

const progressLabel = (progress: FileOperationProgress): string => {
  const values = {
    current: progress.current,
    total: progress.total,
    name: progress.itemName,
  };
  if (progress.operation === "copy") return t("files.progressCopy", values);
  if (progress.operation === "move") return t("files.progressMove", values);
  if (progress.operation === "open") return t("files.progressOpen", values);
  return t("files.progressDelete", values);
};

const progressDetail = (snapshot?: OperationSnapshot): string | undefined => {
  switch (snapshot?.phase) {
    case "rolling-back":
      return t("files.restoringDestination");
    case "cleaning-up":
      return t("files.cleaningUp");
    case "removing-source":
      return t("files.removingSource");
    case "validating":
    case "preparing-copy":
    case "preparing-move":
      return t("files.preparingOperation");
  }
  const progress = snapshot?.progress;
  if (progress?.unit !== "bytes") return undefined;
  return progress.total === undefined
    ? t("files.bytesTransferred", { size: formatFileSize(progress.completed) })
    : t("files.bytesProgress", {
        size: formatFileSize(progress.completed),
        total: formatFileSize(progress.total),
      });
};

interface TransferActivityProps {
  progress: FileOperationProgress | null;
  snapshot?: OperationSnapshot;
  cancelling: boolean;
  onCancel: () => void;
  dialogs: DialogController;
}

export function TransferActivity(props: TransferActivityProps) {
  const label = () =>
    props.cancelling
      ? t("files.cancellingCopy")
      : props.progress
        ? progressLabel(props.progress)
        : t("files.operationFinished");
  const percentage = () => {
    const progress = props.snapshot?.progress;
    if (!progress?.total || progress.total <= 0) return undefined;
    return Math.max(
      0,
      Math.min(99, Math.floor((progress.completed / progress.total) * 100)),
    );
  };
  const icon = () => {
    switch (props.progress?.operation) {
      case "move":
        return FiMove;
      case "delete":
        return FiTrash2;
      case "open":
        return FiExternalLink;
      default:
        return FiCopy;
    }
  };
  const cancelButton = () => (
    <Show when={props.progress?.operation === "copy"}>
      <button
        type="button"
        class="eden-btn eden-btn-ghost eden-btn-sm"
        disabled={props.cancelling}
        aria-label={t("files.cancelTransfer")}
        title={t("files.cancelTransfer")}
        onClick={props.onCancel}
      >
        <FiX aria-hidden="true" />
        <span>{t("common.cancel")}</span>
      </button>
    </Show>
  );
  const status = () => (
    <Show
      when={props.progress}
      fallback={<p role="status">{t("files.operationFinished")}</p>}
    >
      <OperationStatus
        label={label()}
        snapshot={props.snapshot}
        description={progressDetail(props.snapshot)}
      />
    </Show>
  );
  const showDetails = () => {
    void props.dialogs.custom<null>({
      title: t("files.activity"),
      initialValue: null,
      onEnter: "ignore",
      render: status,
      footer: (ctx) => (
        <>
          {cancelButton()}
          <button
            type="button"
            class="eden-btn eden-btn-primary"
            ref={ctx.setPrimaryActionRef}
            onClick={() => ctx.submit()}
          >
            {t("common.close")}
          </button>
        </>
      ),
    });
  };
  return (
    <section class="files-transfer-activity" aria-label={t("files.activity")}>
      <div class="files-transfer-expanded eden-flex-col eden-gap-sm">
        <span class="eden-text-xs eden-text-muted">{t("files.activity")}</span>
        {status()}
        {cancelButton()}
      </div>
      <button
        type="button"
        class="eden-btn eden-btn-ghost files-transfer-compact"
        aria-label={`${t("files.transferDetails")}: ${label()}`}
        title={`${label()}${progressDetail(props.snapshot) ? ` — ${progressDetail(props.snapshot)}` : ""}`}
        onClick={showDetails}
      >
        <span class="files-transfer-indicator" aria-hidden="true">
          <Show
            when={percentage() !== undefined}
            fallback={<span class="eden-spinner" />}
          >
            <svg
              viewBox="0 0 36 36"
              class="files-transfer-ring"
              aria-hidden="true"
            >
              <circle cx="18" cy="18" r="15" />
              <circle
                cx="18"
                cy="18"
                r="15"
                class="files-transfer-ring-progress"
                stroke-dasharray="94.248"
                stroke-dashoffset={94.248 * (1 - (percentage() ?? 0) / 100)}
              />
            </svg>
          </Show>
          <span class="files-transfer-icon">
            <Dynamic component={icon()} />
          </span>
        </span>
        <span class="eden-text-xs">
          {percentage() !== undefined
            ? `${percentage()}%`
            : props.progress
              ? `${props.progress.current}/${props.progress.total}`
              : ""}
        </span>
      </button>
    </section>
  );
}

import { formatFileSize } from "@edenapp/files-core";
import { OperationStatus } from "@edenapp/solid-kit";
import type { OperationSnapshot } from "@edenapp/types";
import {
  FiCheckSquare,
  FiCopy,
  FiMove,
  FiSquare,
  FiTrash2,
  FiX,
} from "solid-icons/fi";
import type { Component } from "solid-js";
import type {
  PendingTransfer,
  TransferOperation,
} from "../features/fileTransfers";
import type { FileOperationProgress } from "../features/useFileTransfers";
import { t } from "../i18n";

interface SelectionActionBarProps {
  selectedCount: number;
  itemCount: number;
  allItemsSelected: boolean;
  busy: boolean;
  readOnly: boolean;
  onToggleAll: () => void;
  onTransfer: (operation: TransferOperation) => void;
  onDelete: () => void;
}

export const SelectionActionBar: Component<SelectionActionBarProps> = (
  props,
) => {
  const toggleAllLabel = () =>
    props.allItemsSelected ? t("files.unselectAll") : t("files.selectAll");

  return (
    <section
      class="file-action-bar mode-action-bar selection-action-bar"
      aria-live="polite"
    >
      <div class="file-action-bar-summary">
        <strong>
          {t("files.selectedCount", { count: props.selectedCount })}
        </strong>
        <button
          type="button"
          class="eden-btn eden-btn-sm selection-action-button"
          aria-label={toggleAllLabel()}
          title={toggleAllLabel()}
          disabled={props.busy || props.itemCount === 0}
          onClick={props.onToggleAll}
        >
          {props.allItemsSelected ? (
            <FiSquare aria-hidden="true" />
          ) : (
            <FiCheckSquare aria-hidden="true" />
          )}
          <span>{toggleAllLabel()}</span>
        </button>
      </div>
      <div class="file-action-bar-actions">
        <button
          type="button"
          class="eden-btn eden-btn-sm selection-action-button"
          disabled={props.busy || props.selectedCount === 0}
          onClick={() => props.onTransfer("copy")}
        >
          <FiCopy aria-hidden="true" />
          <span>{t("files.copy")}</span>
        </button>
        <button
          type="button"
          class="eden-btn eden-btn-sm selection-action-button"
          disabled={props.busy || props.readOnly || props.selectedCount === 0}
          onClick={() => props.onTransfer("move")}
        >
          <FiMove aria-hidden="true" />
          <span>{t("files.move")}</span>
        </button>
        <button
          type="button"
          class="eden-btn eden-btn-danger eden-btn-sm selection-action-button"
          disabled={props.busy || props.readOnly || props.selectedCount === 0}
          onClick={props.onDelete}
        >
          <FiTrash2 aria-hidden="true" />
          <span>{t("common.delete")}</span>
        </button>
      </div>
    </section>
  );
};

interface TransferActionBarProps {
  pendingTransfer: PendingTransfer | null;
  progress: FileOperationProgress | null;
  snapshot?: OperationSnapshot;
  cancelling: boolean;
  busy: boolean;
  readOnly: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

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

export const TransferActionBar: Component<TransferActionBarProps> = (props) => (
  <section
    class="file-action-bar mode-action-bar destination-action-bar"
    aria-live="polite"
  >
    <div class="transfer-status">
      {props.progress ? (
        <OperationStatus
          label={
            props.cancelling
              ? t("files.cancellingCopy")
              : progressLabel(props.progress)
          }
          snapshot={props.snapshot}
          description={progressDetail(props.snapshot)}
        />
      ) : (
        <strong>
          {props.pendingTransfer?.operation === "copy"
            ? t("files.chooseCopyDestination", {
                count: props.pendingTransfer?.items.length ?? 0,
              })
            : t("files.chooseMoveDestination", {
                count: props.pendingTransfer?.items.length ?? 0,
              })}
        </strong>
      )}
    </div>
    {((props.pendingTransfer && !props.busy) ||
      props.progress?.operation === "copy") && (
      <div class="file-action-bar-actions">
        {props.pendingTransfer && !props.busy && (
          <button
            type="button"
            class="eden-btn eden-btn-primary eden-btn-sm"
            disabled={props.readOnly}
            onClick={props.onComplete}
          >
            {props.pendingTransfer.operation === "copy"
              ? t("files.copyHere")
              : t("files.moveHere")}
          </button>
        )}
        <button
          type="button"
          class="eden-btn eden-btn-square eden-btn-sm"
          aria-label={t("common.cancel")}
          title={t("common.cancel")}
          disabled={props.cancelling}
          onClick={props.onCancel}
        >
          <FiX aria-hidden="true" />
        </button>
      </div>
    )}
  </section>
);

import {
  FiCheckSquare,
  FiCopy,
  FiMove,
  FiRotateCcw,
  FiSquare,
  FiTrash2,
  FiX,
} from "solid-icons/fi";
import type { Component } from "solid-js";
import type {
  PendingTransfer,
  TransferOperation,
} from "../features/fileTransfers";
import { t } from "../i18n";

interface SelectionActionBarBase {
  selectedCount: number;
  itemCount: number;
  allItemsSelected: boolean;
  busy: boolean;
  readOnly: boolean;
  onToggleAll: () => void;
  onDelete: () => void;
  deleteLabel?: string;
}

type SelectionActionBarProps = SelectionActionBarBase &
  (
    | { onRestore: () => void; onTransfer?: never }
    | { onRestore?: never; onTransfer: (operation: TransferOperation) => void }
  );

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
        {props.onRestore ? (
          <button
            type="button"
            class="eden-btn eden-btn-sm selection-action-button"
            disabled={props.busy || props.readOnly || props.selectedCount === 0}
            onClick={() => props.onRestore?.()}
          >
            <FiRotateCcw aria-hidden="true" />
            <span>{t("files.restore")}</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              class="eden-btn eden-btn-sm selection-action-button"
              disabled={props.busy || props.selectedCount === 0}
              onClick={() => props.onTransfer?.("copy")}
            >
              <FiCopy aria-hidden="true" />
              <span>{t("files.copy")}</span>
            </button>
            <button
              type="button"
              class="eden-btn eden-btn-sm selection-action-button"
              disabled={
                props.busy || props.readOnly || props.selectedCount === 0
              }
              onClick={() => props.onTransfer?.("move")}
            >
              <FiMove aria-hidden="true" />
              <span>{t("files.move")}</span>
            </button>
          </>
        )}
        <button
          type="button"
          class="eden-btn eden-btn-danger eden-btn-sm selection-action-button"
          disabled={props.busy || props.readOnly || props.selectedCount === 0}
          onClick={props.onDelete}
        >
          <FiTrash2 aria-hidden="true" />
          <span>
            {props.deleteLabel ??
              (props.onRestore
                ? t("files.deletePermanently")
                : t("files.moveToTrash"))}
          </span>
        </button>
      </div>
    </section>
  );
};

interface TransferActionBarProps {
  pendingTransfer: PendingTransfer | null;
  readOnly: boolean;
  onComplete: () => void;
  onCancel: () => void;
}

export const TransferActionBar: Component<TransferActionBarProps> = (props) => (
  <section
    class="file-action-bar mode-action-bar destination-action-bar"
    aria-live="polite"
  >
    <div class="transfer-status">
      <strong>
        {props.pendingTransfer?.operation === "copy"
          ? t("files.chooseCopyDestination", {
              count: props.pendingTransfer.items.length,
            })
          : t("files.chooseMoveDestination", {
              count: props.pendingTransfer?.items.length ?? 0,
            })}
      </strong>
    </div>
    <div class="file-action-bar-actions">
      <button
        type="button"
        class="eden-btn eden-btn-primary eden-btn-sm"
        disabled={props.readOnly}
        onClick={props.onComplete}
      >
        {props.pendingTransfer?.operation === "copy"
          ? t("files.copyHere")
          : t("files.moveHere")}
      </button>
      <button
        type="button"
        class="eden-btn eden-btn-square eden-btn-sm"
        aria-label={t("common.cancel")}
        title={t("common.cancel")}
        onClick={props.onCancel}
      >
        <FiX aria-hidden="true" />
      </button>
    </div>
  </section>
);

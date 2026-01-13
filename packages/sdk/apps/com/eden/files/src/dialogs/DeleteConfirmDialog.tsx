import { t } from "../i18n";
import type { Component } from "solid-js";
import Modal from "../components/Modal";
import type { FileItem } from "../types";

interface DeleteConfirmDialogProps {
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
  item: FileItem | null;
}

const DeleteConfirmDialog: Component<DeleteConfirmDialogProps> = (props) => {
  return (
    <Modal
      show={props.show}
      onClose={props.onClose}
      title={t("common.delete")}
      size="sm"
      footer={
        <>
          <button class="eden-btn" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button class="eden-btn eden-btn-danger" onClick={props.onConfirm}>
             {t("common.delete")}
          </button>
        </>
      }
    >
      <p>{t("common.deleteConfirmation", { name: props.item?.name || "" })}</p>
    </Modal>
  );
};

export default DeleteConfirmDialog;

import type { Component } from "solid-js";
import { createEffect, createSignal } from "solid-js";
import Modal from "../components/Modal";
import { t } from "../i18n";
import type { FileItem } from "../types";

interface RenameDialogProps {
  show: boolean;
  item: FileItem | null;
  onClose: () => void;
  onRename: (name: string) => void;
}

const RenameDialog: Component<RenameDialogProps> = (props) => {
  const [newName, setNewName] = createSignal("");

  createEffect(() => {
    if (props.show && props.item) {
      setNewName(props.item.name);
    }
  });

  const handleRename = () => {
    props.onRename(newName());
  };

  return (
    <Modal
      show={props.show}
      onClose={props.onClose}
      onConfirm={handleRename}
      title={t("files.rename")}
      size="sm"
      footer={
        <>
          <button class="eden-btn" onClick={props.onClose}>
            {t("common.cancel")}
          </button>
          <button class="eden-btn eden-btn-primary" onClick={handleRename}>
            {t("files.rename")}
          </button>
        </>
      }
    >
      <div class="eden-form-group">
        <label class="eden-form-label">{t("common.name")}</label>
        <input
          type="text"
          class="eden-input"
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
        />
      </div>
    </Modal>
  );
};

export default RenameDialog;

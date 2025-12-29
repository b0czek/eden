import { Show } from "solid-js";
import type { Component } from "solid-js";
import Modal from "./Modal";

interface DeleteConfirmDialogProps {
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
  keyName: string;
}

const DeleteConfirmDialog: Component<DeleteConfirmDialogProps> = (props) => {
  return (
    <Modal
      show={props.show}
      onClose={props.onClose}
      title="Delete Entry"
      size="sm"
      footer={
        <>
          <button class="eden-btn eden-btn-ghost" onClick={props.onClose}>
            Cancel
          </button>
          <button class="eden-btn eden-btn-danger" onClick={props.onConfirm}>
            Delete
          </button>
        </>
      }
    >
      <p>
        Are you sure you want to delete the key{" "}
        <strong style={{ "font-family": "var(--eden-font-mono)" }}>
          {props.keyName}
        </strong>
        ?
      </p>
      <p style={{ "margin-top": "var(--eden-space-sm)", color: "var(--eden-color-text-muted)", "font-size": "var(--eden-font-size-sm)" }}>
        This action cannot be undone.
      </p>
    </Modal>
  );
};

export default DeleteConfirmDialog;

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
      title="Confirm Delete"
      size="sm"
      footer={
        <>
          <button class="eden-btn" onClick={props.onClose}>
            Cancel
          </button>
          <button class="eden-btn eden-btn-danger" onClick={props.onConfirm}>
            Delete
          </button>
        </>
      }
    >
      <p>Are you sure you want to delete "{props.item?.name}"?</p>
    </Modal>
  );
};

export default DeleteConfirmDialog;

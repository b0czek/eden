import type { Component } from "solid-js";
import Modal from "../components/Modal";

interface ErrorDialogProps {
  show: boolean;
  onClose: () => void;
  message: string;
}

const ErrorDialog: Component<ErrorDialogProps> = (props) => {
  return (
    <Modal
      show={props.show}
      onClose={props.onClose}
      title="Error"
      size="sm"
      footer={
        <button class="eden-btn eden-btn-primary" onClick={props.onClose}>
          OK
        </button>
      }
    >
      <p>{props.message}</p>
    </Modal>
  );
};

export default ErrorDialog;

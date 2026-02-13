import type { Component } from "solid-js";
import Modal from "../components/Modal";
import { t } from "../i18n";

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
      onConfirm={props.onClose}
      title={t("common.error")}
      size="sm"
      footer={
        <button class="eden-btn eden-btn-primary" onClick={props.onClose}>
          {t("common.ok")}
        </button>
      }
    >
      <p>{props.message}</p>
    </Modal>
  );
};

export default ErrorDialog;

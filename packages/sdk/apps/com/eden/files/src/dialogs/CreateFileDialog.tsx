import { t } from "../i18n";
import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import Modal from "../components/Modal";

interface CreateFileDialogProps {
  show: boolean;
  onClose: () => void;
  onCreate: (name: string) => void;
}

const CreateFileDialog: Component<CreateFileDialogProps> = (props) => {
  const [fileName, setFileName] = createSignal("");

  const handleCreate = () => {
    props.onCreate(fileName());
    setFileName("");
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") {
      props.onClose();
      setFileName("");
    }
  };

  return (
    <Modal
      show={props.show}
      onClose={() => {
        props.onClose();
        setFileName("");
      }}
      title={t("files.newFile")}
      size="sm"
      footer={
        <>
          <button
            class="eden-btn"
            onClick={() => {
              props.onClose();
              setFileName("");
            }}
          >
            {t("common.cancel")}
          </button>
          <button class="eden-btn eden-btn-primary" onClick={handleCreate}>
            {t("common.ok")}
          </button>
        </>
      }
    >
      <div class="eden-form-group">
        <label class="eden-form-label">{t("common.name")}</label>
        <input
          type="text"
          class="eden-input"
          placeholder="example.txt"
          value={fileName()}
          onInput={(e) => setFileName(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
        <p class="eden-form-help">
          {t("files.extensionHelp")}
        </p>
      </div>
    </Modal>
  );
};

export default CreateFileDialog;

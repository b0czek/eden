import { createSignal } from "solid-js";
import type { Component } from "solid-js";
import { t } from "../i18n";
import Modal from "../components/Modal";

interface CreateUserDialogProps {
  show: boolean;
  onClose: () => void;
  onCreate: (args: {
    name: string;
    password: string;
  }) => boolean | Promise<boolean>;
}

const CreateUserDialog: Component<CreateUserDialogProps> = (props) => {
  const [name, setName] = createSignal("");
  const [password, setPassword] = createSignal("");

  const reset = () => {
    setName("");
    setPassword("");
  };

  const handleCreate = async () => {
    const trimmedName = name().trim();
    if (!trimmedName || !password()) return;
    const success = await props.onCreate({
      name: trimmedName,
      password: password(),
    });
    if (success) {
      reset();
    }
  };

  const handleClose = () => {
    props.onClose();
    reset();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleCreate();
    if (e.key === "Escape") handleClose();
  };

  return (
    <Modal
      show={props.show}
      onClose={handleClose}
      title={t("settings.users.addUser")}
      size="sm"
      footer={
        <>
          <button class="eden-btn" onClick={handleClose}>
            {t("common.cancel")}
          </button>
          <button
            class="eden-btn eden-btn-primary"
            onClick={handleCreate}
            disabled={!name().trim() || !password()}
          >
            {t("settings.users.create")}
          </button>
        </>
      }
    >
      <div class="eden-form-group">
        <label class="eden-form-label">{t("settings.users.userName")}</label>
        <input
          type="text"
          class="eden-input"
          placeholder={t("settings.users.userName")}
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div class="eden-form-group">
        <label class="eden-form-label">
          {t("common.password")}
        </label>
        <input
          type="password"
          class="eden-input"
          placeholder={t("common.password")}
          value={password()}
          onInput={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={handleKeyDown}
        />
      </div>
    </Modal>
  );
};

export default CreateUserDialog;

import type { UserProfile } from "@edenapp/types";
import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
import Modal from "../components/Modal";
import { t } from "../i18n";

interface SetPasswordDialogProps {
  show: boolean;
  user: UserProfile | null;
  onClose: () => void;
  onSave: (username: string, password: string) => boolean | Promise<boolean>;
}

const SetPasswordDialog: Component<SetPasswordDialogProps> = (props) => {
  const [password, setPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const reset = () => {
    setPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const handleClose = () => {
    props.onClose();
    reset();
  };

  const handleSave = async () => {
    const user = props.user;
    if (!user) return;
    if (!password() || !confirmPassword()) return;
    if (password() !== confirmPassword()) {
      setError(t("settings.users.passwordMismatch"));
      return;
    }
    const success = await props.onSave(user.username, password());
    if (success) {
      handleClose();
      return;
    }
    setError(t("settings.users.passwordUpdateFailed"));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") handleClose();
  };

  const canSave = () =>
    Boolean(password()) &&
    Boolean(confirmPassword()) &&
    password() === confirmPassword();

  return (
    <Modal
      show={props.show}
      onClose={handleClose}
      title={t("settings.users.setPassword")}
      size="sm"
      footer={
        <>
          <button type="button" class="eden-btn" onClick={handleClose}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            class="eden-btn eden-btn-primary"
            onClick={handleSave}
            disabled={!canSave()}
          >
            {t("settings.users.savePassword")}
          </button>
        </>
      }
    >
      <div class="eden-form-group">
        <label class="eden-form-label" for="set-password-new">
          {t("settings.users.newPassword")}
        </label>
        <input
          id="set-password-new"
          type="password"
          class="eden-input"
          placeholder={t("settings.users.newPassword")}
          value={password()}
          onInput={(e) => {
            setPassword(e.currentTarget.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <div class="eden-form-group">
        <label class="eden-form-label" for="set-password-confirm">
          {t("settings.users.confirmPassword")}
        </label>
        <input
          id="set-password-confirm"
          type="password"
          class="eden-input"
          placeholder={t("settings.users.confirmPassword")}
          value={confirmPassword()}
          onInput={(e) => {
            setConfirmPassword(e.currentTarget.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      <Show when={error()}>
        <div class="eden-text-xs" style={{ color: "var(--eden-color-danger)" }}>
          {error()}
        </div>
      </Show>
    </Modal>
  );
};

export default SetPasswordDialog;

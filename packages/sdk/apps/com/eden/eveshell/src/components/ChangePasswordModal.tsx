import { type Component, createSignal, Show } from "solid-js";
import { t } from "../i18n";

interface ChangePasswordModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: (args: {
    currentPassword: string;
    newPassword: string;
  }) => Promise<{ success: boolean; error?: string }>;
}

const ChangePasswordModal: Component<ChangePasswordModalProps> = (props) => {
  const [currentPassword, setCurrentPassword] = createSignal("");
  const [newPassword, setNewPassword] = createSignal("");
  const [confirmPassword, setConfirmPassword] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setError(null);
  };

  const handleClose = () => {
    props.onClose();
    reset();
  };

  const handleSubmit = async () => {
    if (!currentPassword() || !newPassword() || !confirmPassword()) return;
    if (newPassword() !== confirmPassword()) {
      setError(t("shell.passwordMismatch"));
      return;
    }
    const result = await props.onSubmit({
      currentPassword: currentPassword(),
      newPassword: newPassword(),
    });
    if (result.success) {
      handleClose();
      return;
    }
    setError(result.error || t("shell.passwordUpdateFailed"));
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") handleClose();
  };

  const canSave = () =>
    Boolean(currentPassword()) &&
    Boolean(newPassword()) &&
    Boolean(confirmPassword()) &&
    newPassword() === confirmPassword();

  return (
    <Show when={props.show}>
      <div class="eden-modal-overlay" onClick={handleClose}>
        <div
          class="eden-modal eden-modal-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div class="eden-modal-header">
            <h3 class="eden-modal-title">{t("shell.changePassword")}</h3>
            <button class="eden-modal-close" onClick={handleClose}>
              ×
            </button>
          </div>
          <div class="eden-modal-body">
            <div class="eden-form-group">
              <label class="eden-form-label">
                {t("shell.currentPassword")}
              </label>
              <input
                type="password"
                class="eden-input"
                placeholder={t("shell.currentPassword")}
                value={currentPassword()}
                onInput={(e) => {
                  setCurrentPassword(e.currentTarget.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
              />
            </div>
            <div class="eden-form-group">
              <label class="eden-form-label">{t("shell.newPassword")}</label>
              <input
                type="password"
                class="eden-input"
                placeholder={t("shell.newPassword")}
                value={newPassword()}
                onInput={(e) => {
                  setNewPassword(e.currentTarget.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
              />
            </div>
            <div class="eden-form-group">
              <label class="eden-form-label">
                {t("shell.confirmPassword")}
              </label>
              <input
                type="password"
                class="eden-input"
                placeholder={t("shell.confirmPassword")}
                value={confirmPassword()}
                onInput={(e) => {
                  setConfirmPassword(e.currentTarget.value);
                  setError(null);
                }}
                onKeyDown={handleKeyDown}
              />
            </div>
            <Show when={error()}>
              <div
                class="eden-text-xs"
                style={{ color: "var(--eden-color-danger)" }}
              >
                {error()}
              </div>
            </Show>
          </div>
          <div class="eden-modal-footer">
            <button class="eden-btn" onClick={handleClose}>
              {t("common.cancel")}
            </button>
            <button
              class="eden-btn eden-btn-primary"
              onClick={handleSubmit}
              disabled={!canSave()}
            >
              {t("shell.savePassword")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ChangePasswordModal;

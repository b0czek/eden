import { Alert, Button, Dialog, TextField } from "@edenapp/solid-kit";
import type { UserProfile } from "@edenapp/types";
import type { Component } from "solid-js";
import { createSignal, Show } from "solid-js";
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
    if (!user || !password() || !confirmPassword()) return;
    if (password() !== confirmPassword()) {
      setError(t("settings.users.passwordMismatch"));
      return;
    }
    const success = await props.onSave(user.username, password());
    if (success) handleClose();
    else setError(t("settings.users.passwordUpdateFailed"));
  };

  const canSave = () =>
    Boolean(password()) &&
    Boolean(confirmPassword()) &&
    password() === confirmPassword();

  return (
    <Dialog
      open={props.show}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content size="sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            <div class="eden-modal-header">
              <Dialog.Title>{t("settings.users.setPassword")}</Dialog.Title>
              <Dialog.CloseButton aria-label={t("common.close")}>
                ×
              </Dialog.CloseButton>
            </div>
            <div class="eden-modal-body eden-flex-col eden-gap-md">
              <TextField>
                <TextField.Label for="set-password-new">
                  {t("settings.users.newPassword")}
                </TextField.Label>
                <TextField.Input
                  id="set-password-new"
                  type="password"
                  placeholder={t("settings.users.newPassword")}
                  value={password()}
                  onInput={(event) => {
                    setPassword(event.currentTarget.value);
                    setError(null);
                  }}
                  autofocus
                />
              </TextField>
              <TextField>
                <TextField.Label for="set-password-confirm">
                  {t("settings.users.confirmPassword")}
                </TextField.Label>
                <TextField.Input
                  id="set-password-confirm"
                  type="password"
                  placeholder={t("settings.users.confirmPassword")}
                  value={confirmPassword()}
                  onInput={(event) => {
                    setConfirmPassword(event.currentTarget.value);
                    setError(null);
                  }}
                />
              </TextField>
              <Show when={error()}>
                <Alert tone="danger">{error()}</Alert>
              </Show>
            </div>
            <div class="eden-modal-footer">
              <Button type="button" variant="ghost" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button variant="primary" type="submit" disabled={!canSave()}>
                {t("settings.users.savePassword")}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};

export default SetPasswordDialog;

import { Button, Dialog, TextField } from "@edenapp/solid-kit";
import type { Component } from "solid-js";
import { createSignal } from "solid-js";
import { t } from "../i18n";

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
    if (success) reset();
  };

  const handleClose = () => {
    props.onClose();
    reset();
  };

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
              void handleCreate();
            }}
          >
            <div class="eden-modal-header">
              <Dialog.Title>{t("settings.users.addUser")}</Dialog.Title>
              <Dialog.CloseButton aria-label={t("common.close")}>
                ×
              </Dialog.CloseButton>
            </div>
            <div class="eden-modal-body eden-flex-col eden-gap-md">
              <TextField>
                <TextField.Label for="create-user-name">
                  {t("settings.users.userName")}
                </TextField.Label>
                <TextField.Input
                  id="create-user-name"
                  type="text"
                  placeholder={t("settings.users.userName")}
                  value={name()}
                  onInput={(event) => setName(event.currentTarget.value)}
                  autofocus
                />
              </TextField>
              <TextField>
                <TextField.Label for="create-user-password">
                  {t("common.password")}
                </TextField.Label>
                <TextField.Input
                  id="create-user-password"
                  type="password"
                  placeholder={t("common.password")}
                  value={password()}
                  onInput={(event) => setPassword(event.currentTarget.value)}
                />
              </TextField>
            </div>
            <div class="eden-modal-footer">
              <Button type="button" variant="ghost" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={!name().trim() || !password()}
              >
                {t("settings.users.create")}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};

export default CreateUserDialog;

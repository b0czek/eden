import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { field } from "@edenapp/solid-kit/dialogs";
import { t } from "../i18n";

interface ChangePasswordSubmitArgs {
  currentPassword: string;
  newPassword: string;
}

interface ChangePasswordSubmitResult {
  success: boolean;
  error?: string;
}

interface OpenChangePasswordDialogOptions {
  dialogs: DialogController;
}

const submitChangePassword = async (
  args: ChangePasswordSubmitArgs,
): Promise<ChangePasswordSubmitResult> => {
  try {
    return await window.edenAPI.shellCommand("user/change-password", args);
  } catch (error) {
    console.error("Failed to change password:", error);
    return { success: false, error: t("shell.passwordUpdateFailed") };
  }
};

export const openChangePasswordDialog = async (
  options: OpenChangePasswordDialogOptions,
): Promise<boolean> => {
  const result = await options.dialogs.form({
    title: t("shell.changePassword"),
    confirmLabel: t("shell.savePassword"),
    cancelLabel: t("common.cancel"),
    fields: [
      field.password("currentPassword", t("shell.currentPassword"), {
        required: true,
        autofocus: true,
      }),
      field.password("newPassword", t("shell.newPassword"), {
        required: true,
      }),
      field.password("confirmPassword", t("shell.confirmPassword"), {
        required: true,
      }),
    ] as const,
    validate: (values) => {
      return values.newPassword !== values.confirmPassword
        ? t("shell.passwordMismatch")
        : null;
    },
    onSubmit: async (values) => {
      const submitResult = await submitChangePassword({
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      });

      if (submitResult.success) {
        return null;
      }

      return submitResult.error || t("shell.passwordUpdateFailed");
    },
  });

  return result !== null;
};

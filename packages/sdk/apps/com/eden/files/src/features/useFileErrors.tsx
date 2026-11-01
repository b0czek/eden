import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { For } from "solid-js";
import { errorDetails, FileError } from "../components/FileError";
import { t } from "../i18n";

export type ShowFileError = (message: string, details?: unknown) => void;
export interface FileFailure {
  name: string;
  error: unknown;
}
export type ShowFileFailures = (
  failures: FileFailure[],
  succeeded: number,
) => Promise<void>;

export function useFileErrors(dialogs: DialogController) {
  const showError: ShowFileError = (message, details) => {
    void dialogs.alert({
      title: t("common.error"),
      message: <FileError message={message} details={details} />,
      okLabel: t("common.ok"),
    });
  };
  const showFailures: ShowFileFailures = async (failures, succeeded) => {
    if (!failures.length) return;
    await dialogs.alert({
      title: t("files.partialFailureTitle"),
      message: (
        <div class="eden-flex-col eden-gap-md">
          <p>
            {t("files.partialFailureMessage", {
              succeeded,
              failed: failures.length,
            })}
          </p>
          <ul class="files-failure-list eden-flex-col eden-gap-sm">
            <For each={failures}>
              {(failure) => (
                <li>
                  <FileError
                    message={failure.name}
                    details={errorDetails(failure.error)}
                  />
                </li>
              )}
            </For>
          </ul>
        </div>
      ),
      okLabel: t("common.ok"),
    });
  };
  return { showError, showFailures };
}

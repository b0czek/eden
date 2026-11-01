import { Show } from "solid-js";
import { t } from "../i18n";

export const errorDetails = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const fileErrorMessage = (message: string, details?: unknown) => (
  <FileError message={message} details={details} />
);

export function FileError(props: { message: string; details?: unknown }) {
  return (
    <div class="eden-flex-col eden-gap-sm">
      <p>{props.message}</p>
      <Show when={props.details != null}>
        <details class="files-error-details">
          <summary>{t("files.technicalDetails")}</summary>
          <pre class="eden-text-sm">{errorDetails(props.details)}</pre>
        </details>
      </Show>
    </div>
  );
}

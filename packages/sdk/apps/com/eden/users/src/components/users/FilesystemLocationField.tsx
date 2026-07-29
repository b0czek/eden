import { filePicker } from "@edenapp/tablets";
import { FaSolidFolderOpen } from "solid-icons/fa";
import { createSignal, Show } from "solid-js";
import { t } from "../../i18n";

interface FilesystemLocationFieldProps {
  id: string;
  value: string;
  onInput: (value: string) => void;
  onCommit?: (value: string) => void;
}

export default function FilesystemLocationField(
  props: FilesystemLocationFieldProps,
) {
  const [pickerError, setPickerError] = createSignal(false);

  const openPicker = async () => {
    setPickerError(false);
    try {
      const initialPath = props.value.trim()
        ? `/${props.value.trim().replace(/^[\\/]+/, "")}`
        : "/";
      const selectedPath = await filePicker.openDirectory({
        title: t("settings.users.filesystemLocationPickerTitle"),
        confirmLabel: t("settings.users.chooseLocation"),
        initialPath,
        canCreateDirectories: true,
      });
      if (selectedPath !== null) {
        const value = selectedPath.replace(/^[\\/]+/, "");
        props.onInput(value);
        props.onCommit?.(value);
      }
    } catch (error) {
      console.error("Failed to open filesystem location picker:", error);
      setPickerError(true);
    }
  };

  return (
    <>
      <div
        class="user-filesystem-location-row"
        onFocusOut={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            !(nextTarget instanceof Node) ||
            !event.currentTarget.contains(nextTarget)
          ) {
            props.onCommit?.(props.value);
          }
        }}
      >
        <input
          id={props.id}
          type="text"
          class="eden-input user-filesystem-location-path"
          placeholder={t("settings.users.filesystemLocationPlaceholder")}
          value={props.value}
          onInput={(event) => props.onInput(event.currentTarget.value)}
        />
        <button
          type="button"
          class="eden-btn eden-btn-square"
          title={t("settings.users.chooseLocation")}
          aria-label={t("settings.users.chooseLocation")}
          onClick={openPicker}
        >
          <FaSolidFolderOpen />
        </button>
      </div>
      <Show when={pickerError()}>
        <span class="eden-form-error">
          {t("settings.users.filesystemLocationPickerFailed")}
        </span>
      </Show>
    </>
  );
}

import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { For } from "solid-js";
import { PinColorSwatch } from "../components/PinnedFolderMarker";
import { PIN_COLORS, type PinnedFolder } from "../features/pinnedFolders";
import { t } from "../i18n";

export function editPinnedFolder(options: {
  dialogs: DialogController;
  pin: PinnedFolder;
  adding: boolean;
}) {
  return options.dialogs.custom<PinnedFolder>({
    title: options.adding ? t("files.pinFolder") : t("files.editPinnedFolder"),
    initialValue: options.pin,
    onEnter: "ignore",
    render: (ctx) => (
      <div class="eden-flex-col eden-gap-md">
        <label class="eden-form-group">
          <span class="eden-form-label">{t("common.name")}</span>
          <input
            class="eden-input"
            value={ctx.value().label}
            maxLength={64}
            ref={ctx.setInitialFocusRef}
            onInput={(event) => {
              const label = event.currentTarget.value;
              ctx.setValue((pin) => ({ ...pin, label }));
              ctx.setCanSubmit(Boolean(label.trim()));
            }}
          />
        </label>
        <fieldset class="files-pin-color-picker">
          <legend class="eden-form-label">{t("files.pinColor")}</legend>
          <div class="files-pin-colors">
            <For each={PIN_COLORS}>
              {(color) => (
                <button
                  type="button"
                  class="eden-btn eden-btn-ghost eden-btn-sm"
                  aria-pressed={ctx.value().color === color}
                  onClick={() => ctx.setValue((pin) => ({ ...pin, color }))}
                >
                  <PinColorSwatch
                    color={color}
                    selected={ctx.value().color === color}
                  />
                  <span>{t(`files.pinColors.${color}`)}</span>
                </button>
              )}
            </For>
          </div>
        </fieldset>
      </div>
    ),
    footer: (ctx) => (
      <>
        <button type="button" class="eden-btn" onClick={() => ctx.cancel()}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          class="eden-btn eden-btn-primary"
          ref={ctx.setPrimaryActionRef}
          disabled={!ctx.canSubmit()}
          onClick={() => ctx.submit()}
        >
          {options.adding ? t("files.pinFolder") : t("common.save")}
        </button>
      </>
    ),
  });
}

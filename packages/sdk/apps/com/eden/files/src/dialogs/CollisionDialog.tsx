import type { DialogController } from "@edenapp/solid-kit/dialogs";
import type { CollisionDecision } from "../features/fileTransfers";
import { t } from "../i18n";

interface CollisionDialogOptions {
  dialogs: DialogController;
  itemName: string;
  targetPath: string;
}

interface CollisionDialogValue {
  applyToAll: boolean;
}

export const openCollisionDialog = async (
  options: CollisionDialogOptions,
): Promise<CollisionDecision> => {
  return options.dialogs.custom<CollisionDialogValue, CollisionDecision>({
    title: t("files.collisionTitle"),
    message: t("files.collisionMessage", { name: options.itemName }),
    initialValue: { applyToAll: false },
    cancelResult: { action: "cancel", applyToAll: false },
    onEnter: "ignore",
    render: (ctx) => (
      <div class="eden-flex-col eden-gap-md">
        <p class="eden-form-help">{options.targetPath}</p>
        <label class="eden-checkbox-option">
          <input
            type="checkbox"
            class="eden-checkbox"
            checked={ctx.value().applyToAll}
            onChange={(event) =>
              ctx.setValue({ applyToAll: event.currentTarget.checked })
            }
          />
          <span class="eden-checkbox-option-label">
            {t("files.applyToAll")}
          </span>
        </label>
      </div>
    ),
    footer: (ctx) => (
      <>
        <button type="button" class="eden-btn" onClick={() => ctx.cancel()}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          class="eden-btn"
          onClick={() =>
            ctx.submit({
              action: "skip",
              applyToAll: ctx.value().applyToAll,
            })
          }
        >
          {t("files.skip")}
        </button>
        <button
          type="button"
          ref={ctx.setInitialFocusRef}
          class="eden-btn eden-btn-primary"
          onClick={() =>
            ctx.submit({
              action: "keep-both",
              applyToAll: ctx.value().applyToAll,
            })
          }
        >
          {t("files.keepBoth")}
        </button>
        <button
          type="button"
          class="eden-btn eden-btn-danger"
          onClick={() =>
            ctx.submit({
              action: "replace",
              applyToAll: ctx.value().applyToAll,
            })
          }
        >
          {t("files.replace")}
        </button>
      </>
    ),
  });
};

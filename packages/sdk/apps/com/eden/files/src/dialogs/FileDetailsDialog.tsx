import { type FileItem, formatFileSize } from "@edenapp/files-core";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import type { FilesystemLocation } from "@edenapp/types";
import { Show } from "solid-js";
import { locale, t } from "../i18n";

export function openFileDetailsDialog(options: {
  dialogs: DialogController;
  item: FileItem;
  original?: FilesystemLocation;
  deletedAt?: string;
  canRestore?: () => boolean;
}) {
  const location = options.original ?? options.item.location;
  return options.dialogs.custom<undefined, "restore" | null>({
    title: t("files.details"),
    initialValue: undefined,
    cancelResult: null,
    onEnter: "ignore",
    render: () => (
      <dl class="files-item-details eden-flex-col eden-gap-md">
        <div>
          <dt class="eden-text-muted eden-text-sm">{t("common.name")}</dt>
          <dd>{options.item.name}</dd>
        </div>
        <div>
          <dt class="eden-text-muted eden-text-sm">
            {options.original
              ? t("files.originalLocation")
              : t("files.location")}
          </dt>
          <dd>{location.path}</dd>
        </div>
        <div>
          <dt class="eden-text-muted eden-text-sm">{t("files.volume")}</dt>
          <dd>
            {location.volume === "home" ? t("files.home") : location.volume}
          </dd>
        </div>
        <Show when={options.item.isFile}>
          <div>
            <dt class="eden-text-muted eden-text-sm">{t("common.size")}</dt>
            <dd>{formatFileSize(options.item.size)}</dd>
          </div>
        </Show>
        <div>
          <dt class="eden-text-muted eden-text-sm">
            {options.deletedAt ? t("files.dateDeleted") : t("files.modified")}
          </dt>
          <dd>
            {new Date(
              options.deletedAt ?? options.item.modified,
            ).toLocaleString(locale())}
          </dd>
        </div>
      </dl>
    ),
    footer: (ctx) => (
      <>
        <button
          type="button"
          ref={ctx.setInitialFocusRef}
          class="eden-btn"
          onClick={() => ctx.cancel()}
        >
          {t("common.close")}
        </button>
        <Show when={options.canRestore}>
          <button
            type="button"
            class="eden-btn eden-btn-primary"
            disabled={!options.canRestore?.()}
            onClick={() => ctx.submit("restore")}
          >
            {t("files.restore")}
          </button>
        </Show>
      </>
    ),
  });
}

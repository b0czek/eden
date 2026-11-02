import {
  type DisplayPreferences,
  FileGraphic,
  FileList,
  fileIcons,
  getParentPath,
} from "@edenapp/files-core";
import { FiAlertTriangle } from "solid-icons/fi";
import { Show } from "solid-js";
import type { Trash } from "../features/useTrash";
import { getTrashLabels, locale, t } from "../i18n";
import { FileError } from "./FileError";
import { SelectionActionBar } from "./FileModeActionBars";

const formatDeletedAt = (value: string) => {
  const date = new Date(value);
  return date.toLocaleString(locale(), {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export function TrashView(props: {
  trash: Trash;
  preferences: DisplayPreferences;
  activateOnSingleClick: boolean;
  onBack: () => void;
}) {
  const trash = props.trash;
  const selection = trash.selection;
  return (
    <section
      class="files-trash eden-flex-col"
      aria-label={t("files.trash")}
      aria-busy={trash.busy() || trash.loading()}
    >
      <Show when={selection.selectionMode()}>
        <SelectionActionBar
          selectedCount={selection.selectedPaths().length}
          itemCount={trash.items().length}
          allItemsSelected={selection.allItemsSelected()}
          busy={trash.busy()}
          readOnly={false}
          onToggleAll={selection.toggleAll}
          onRestore={() => void trash.restoreSelected()}
          onDelete={() => void trash.deleteSelected()}
          deleteLabel={t("files.deletePermanently")}
        />
      </Show>
      <Show when={trash.error()}>
        {(error) => (
          <div
            class="eden-alert eden-alert-warning eden-flex eden-gap-sm"
            role="alert"
          >
            <FiAlertTriangle aria-hidden="true" />
            <FileError
              message={t("files.errors.loadTrashFailed")}
              details={error()}
            />
          </div>
        )}
      </Show>
      <FileList
        labels={getTrashLabels()}
        loading={trash.loading()}
        items={trash.items()}
        getItemKey={trash.itemKey}
        emptyIcon={<FileGraphic src={fileIcons.trash} />}
        showEmpty={!trash.error()}
        selectedItem={trash.selectedItem()}
        selectedPaths={
          selection.selectionMode() ? selection.selectedPaths() : undefined
        }
        selectionMode={selection.selectionMode()}
        scrollToSelected={trash.scrollToSelected()}
        viewStyle={props.preferences.viewStyle}
        itemSize={props.preferences.itemSize}
        onItemClick={trash.handleItemClick}
        onItemFocus={selection.focusItem}
        onSelectionToggle={selection.toggleItem}
        onItemContextMenu={trash.handleItemContextMenu}
        onBackgroundContextMenu={trash.handleBackgroundContextMenu}
        onItemActivate={(item) => void trash.showDetails(item)}
        activateOnSingleClick={props.activateOnSingleClick}
        onItemDeleteShortcut={
          selection.selectionMode() ? undefined : trash.deleteItem
        }
        onBack={props.onBack}
        disabled={trash.busy()}
        renderItemMetadata={(item) => {
          const entry = trash.entryFor(item);
          if (!entry) return undefined;
          return (
            <div class="file-meta files-trash-item-meta">
              <span
                title={`${t("files.originalLocation")}: ${entry.original.path}`}
              >
                {getParentPath(entry.original.path)}
              </span>
              <time dateTime={entry.deletedAt} title={t("files.dateDeleted")}>
                {formatDeletedAt(entry.deletedAt)}
              </time>
            </div>
          );
        }}
      />
    </section>
  );
}

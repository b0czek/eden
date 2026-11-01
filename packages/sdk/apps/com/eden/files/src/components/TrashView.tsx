import {
  type DisplayPreferences,
  FileGraphic,
  FileList,
  fileIcons,
  getParentPath,
} from "@edenapp/files-core";
import { FiAlertTriangle } from "solid-icons/fi";
import { Show } from "solid-js";
import type { useTrash } from "../features/useTrash";
import type { useTrashBrowser } from "../features/useTrashBrowser";
import { locale, t } from "../i18n";
import { errorDetails } from "./FileError";
import { SelectionActionBar } from "./FileModeActionBars";

export function TrashView(props: {
  trash: ReturnType<typeof useTrash>;
  browser: ReturnType<typeof useTrashBrowser>;
  preferences: DisplayPreferences;
  activateOnSingleClick: boolean;
  onBack: () => void;
}) {
  return (
    <section
      class="files-trash eden-flex-col"
      aria-label={t("files.trash")}
      aria-busy={props.trash.busy() || props.trash.loading()}
    >
      <Show when={props.browser.selection.selectionMode()}>
        <SelectionActionBar
          selectedCount={props.browser.selection.selectedPaths().length}
          itemCount={props.browser.items().length}
          allItemsSelected={props.browser.selection.allItemsSelected()}
          busy={props.browser.busy()}
          readOnly={props.browser.selectionReadOnly()}
          onToggleAll={props.browser.selection.toggleAll}
          onRestore={() => void props.browser.restoreSelected()}
          onDelete={() => void props.browser.deleteSelected()}
        />
      </Show>
      <Show when={props.trash.error()}>
        {(error) => (
          <div
            class="eden-alert eden-alert-warning eden-flex eden-gap-sm files-trash-load-error"
            role="alert"
          >
            <FiAlertTriangle aria-hidden="true" />
            <div class="eden-flex-col eden-gap-xs">
              <strong>{error().message}</strong>
              <span class="eden-text-sm">{t("files.trashLoadIncomplete")}</span>
              <Show when={error().details != null}>
                <details class="files-error-details">
                  <summary>{t("files.technicalDetails")}</summary>
                  <pre class="eden-text-sm">
                    {errorDetails(error().details)}
                  </pre>
                </details>
              </Show>
            </div>
          </div>
        )}
      </Show>
      <FileList
        labels={props.browser.labels()}
        loading={props.trash.loading()}
        items={props.browser.items()}
        getItemKey={props.browser.itemKey}
        emptyIcon={<FileGraphic src={fileIcons.trash} />}
        showEmpty={!props.trash.error()}
        selectedItem={props.browser.selectedItem()}
        selectedPaths={
          props.browser.selection.selectionMode()
            ? props.browser.selection.selectedPaths()
            : undefined
        }
        selectionMode={props.browser.selection.selectionMode()}
        scrollToSelected={props.browser.scrollToSelected()}
        viewStyle={props.preferences.viewStyle}
        itemSize={props.preferences.itemSize}
        onItemClick={props.browser.handleItemClick}
        onItemFocus={props.browser.selection.focusItem}
        onSelectionToggle={props.browser.toggleItem}
        onItemContextMenu={props.browser.handleItemContextMenu}
        onBackgroundContextMenu={props.browser.handleBackgroundContextMenu}
        onItemActivate={(item) => void props.browser.showDetails(item)}
        activateOnSingleClick={props.activateOnSingleClick}
        onItemDeleteShortcut={(item) => {
          const entry = props.browser.entryFor(item);
          if (entry) void props.trash.deletePermanently([entry]);
        }}
        onBack={props.onBack}
        disabled={props.browser.busy()}
        renderItemMetadata={(item) => {
          const entry = props.browser.entryFor(item);
          return (
            entry && (
              <div class="file-meta files-trash-item-meta">
                <span
                  title={`${t("files.originalLocation")}: ${entry.original.path}`}
                >
                  {getParentPath(entry.original.path)}
                </span>
                <time dateTime={entry.deletedAt} title={t("files.dateDeleted")}>
                  {new Date(entry.deletedAt).toLocaleString(locale(), {
                    month: "short",
                    day: "numeric",
                    year:
                      new Date(entry.deletedAt).getFullYear() ===
                      new Date().getFullYear()
                        ? undefined
                        : "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
                <Show when={!props.trash.canModify(entry)}>
                  <span>{t("files.readOnly")}</span>
                </Show>
              </div>
            )
          );
        }}
      />
    </section>
  );
}

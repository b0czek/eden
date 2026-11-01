import type { FileExplorerLabels, FileItem } from "@edenapp/files-core";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { button, menu, separator, title } from "@edenapp/tablets";
import type { FilesystemLocation } from "@edenapp/types";
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import { openFileDetailsDialog } from "../dialogs/FileDetailsDialog";
import { t } from "../i18n";
import type { TrashEntry } from "./trash";
import { useFileSelection } from "./useFileSelection";
import type { useTrash } from "./useTrash";

const itemKey = (item: Pick<FileItem, "location">) =>
  JSON.stringify([item.location.volume, item.location.path]);

export function useTrashBrowser(props: {
  trash: ReturnType<typeof useTrash>;
  dialogs: DialogController;
  disabled: boolean;
  location?: FilesystemLocation;
  labels: FileExplorerLabels;
  sortItems: (items: FileItem[]) => FileItem[];
  active: () => boolean;
}) {
  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [scrollToSelected, setScrollToSelected] = createSignal(false);
  const busy = () =>
    props.disabled || props.trash.busy() || props.trash.loading();
  let cache = new Map<string, { entry: TrashEntry; item: FileItem }>();
  const items = createMemo(() => {
    const next = new Map<string, { entry: TrashEntry; item: FileItem }>();
    const result = props.trash.entries().map((entry) => {
      const key = JSON.stringify([entry.content.volume, entry.content.path]);
      const cached = cache.get(key);
      const item =
        cached?.entry === entry
          ? cached.item
          : {
              location: entry.content,
              name: entry.name,
              isDirectory: entry.isDirectory,
              isFile: entry.isFile,
              size: entry.size,
              modified: new Date(entry.deletedAt),
            };
      next.set(key, { entry, item });
      return item;
    });
    cache = next;
    return props.sortItems(result);
  });
  const entryFor = (item: FileItem) => cache.get(itemKey(item))?.entry;
  const selection = useFileSelection({
    items,
    getItemKey: itemKey,
    currentPath: () => JSON.stringify([props.active(), props.location ?? null]),
    selectedItem,
    setSelectedItem,
    setScrollToSelected,
  });
  createEffect(
    on(props.active, (active) => {
      if (!active) selection.exit();
    }),
  );
  const toggleItem = (item: FileItem, event?: MouseEvent | KeyboardEvent) => {
    if (!selection.selectionMode()) setSelectedItem(null);
    selection.toggleItem(item, event);
  };
  const handleItemClick = (
    item: FileItem,
    event?: MouseEvent | KeyboardEvent,
  ) => {
    if (
      selection.selectionMode() ||
      event?.ctrlKey ||
      event?.metaKey ||
      event?.shiftKey
    ) {
      selection.toggleItem(item, event);
    } else {
      selection.focusItem(item);
    }
  };
  const selectedEntries = createMemo(() =>
    selection.selectedFiles().flatMap((item) => {
      const entry = entryFor(item);
      return entry ? [entry] : [];
    }),
  );
  const selectionReadOnly = () =>
    selectedEntries().some((entry) => !props.trash.canModify(entry));
  const runEntries = async (
    entries: TrashEntry[],
    action: (entries: TrashEntry[]) => Promise<void>,
  ) => {
    if (!props.active() || busy()) return;
    const current = entries.flatMap((entry) => {
      const cached = cache.get(itemKey({ location: entry.content }));
      return cached ? [cached.entry] : [];
    });
    if (
      !current.length ||
      current.some((entry) => !props.trash.canModify(entry))
    )
      return;
    await action(current);
    if (!selection.selectedFiles().length) selection.exit();
  };
  const restoreSelected = () =>
    runEntries(selectedEntries(), props.trash.restoreMany);
  const deleteSelected = () =>
    runEntries(selectedEntries(), (entries) =>
      props.trash.deletePermanently(entries),
    );
  const showDetails = async (item: FileItem) => {
    const entry = entryFor(item);
    if (!entry || !props.active() || busy()) return;
    const action = await openFileDetailsDialog({
      dialogs: props.dialogs,
      item,
      original: entry.original,
      deletedAt: entry.deletedAt,
      canRestore: () => !busy() && props.trash.canModify(entry),
    });
    if (action === "restore")
      await runEntries([entry], props.trash.restoreMany);
  };
  const itemMenu = menu((entries: TrashEntry[]) => {
    const disabled =
      busy() || entries.some((entry) => !props.trash.canModify(entry));
    return [
      title(
        entries.length === 1
          ? entries[0].name
          : t("files.selectedCount", { count: entries.length }),
      ),
      button(
        "restore",
        t("files.restore"),
        () => runEntries(entries, props.trash.restoreMany),
        {
          icon: "rotate-ccw",
          disabled,
        },
      ),
      ...(entries.length === 1
        ? [
            button(
              "details",
              t("files.details"),
              () => {
                const cached = cache.get(
                  itemKey({ location: entries[0].content }),
                );
                if (cached) void showDetails(cached.item);
              },
              { icon: "info", disabled: busy() },
            ),
          ]
        : []),
      separator(),
      button(
        "delete-permanently",
        t("files.deletePermanently"),
        () =>
          runEntries(entries, (current) =>
            props.trash.deletePermanently(current),
          ),
        {
          icon: "trash",
          danger: true,
          disabled,
        },
      ),
    ];
  });
  const backgroundMenu = menu((entries: TrashEntry[]) => [
    title(t("files.trash")),
    button(
      "select-all",
      t("files.selectAll"),
      () => {
        if (props.active() && !busy()) selection.selectAll();
      },
      { icon: "check", disabled: !entries.length },
    ),
    button(
      "refresh",
      t("files.refresh"),
      async () => {
        if (props.active() && !busy()) await props.trash.refresh();
      },
      { icon: "refresh-cw" },
    ),
    separator(),
    button(
      "empty-trash",
      t("files.emptyTrash"),
      () =>
        runEntries(entries.filter(props.trash.canModify), (current) =>
          props.trash.deletePermanently(current, true),
        ),
      {
        icon: "trash",
        danger: true,
        disabled: !entries.some(props.trash.canModify),
      },
    ),
  ]);
  const handleItemContextMenu = (item: FileItem, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!props.active() || busy()) return;
    const entry = entryFor(item);
    if (!entry) return;
    const entries =
      selection.selectionMode() &&
      selection.selectedPaths().includes(itemKey(item))
        ? selectedEntries()
        : [entry];
    if (!selection.selectedPaths().includes(itemKey(item))) {
      selection.exit();
    }
    selection.focusItem(item);
    void itemMenu.show(entries, {
      left: event.clientX,
      top: event.clientY,
    });
  };
  const handleBackgroundContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (
      !props.active() ||
      busy() ||
      (event.target as HTMLElement)?.closest(".file-item")
    )
      return;
    void backgroundMenu.show(props.trash.entries(), {
      left: event.clientX,
      top: event.clientY,
    });
  };
  const labels = () => ({
    ...props.labels,
    empty: t("files.trashEmpty"),
    emptyHint: t("files.trashHint"),
    modified: t("files.dateDeleted"),
  });
  const handleKeyDown = (event: KeyboardEvent) => {
    if (!props.active() || document.querySelector('[role="dialog"]')) return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        target.isContentEditable)
    )
      return;
    if (event.key === "Escape") selection.exit();
    if (busy()) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selection.selectAll();
    }
    if (event.key === "Delete" && selection.selectionMode()) {
      event.preventDefault();
      void deleteSelected();
    }
  };
  document.addEventListener("keydown", handleKeyDown);
  onCleanup(() => document.removeEventListener("keydown", handleKeyDown));

  return {
    itemKey,
    items,
    selection,
    selectedItem,
    scrollToSelected,
    busy,
    labels,
    toggleItem,
    handleItemClick,
    handleItemContextMenu,
    handleBackgroundContextMenu,
    restoreSelected,
    deleteSelected,
    selectionReadOnly,
    entryFor,
    showDetails,
  };
}

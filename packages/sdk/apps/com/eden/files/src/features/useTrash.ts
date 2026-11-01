import * as eden from "@edenapp/client";
import { type FileItem, getParentPath, joinPath } from "@edenapp/files-core";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { button, menu, separator, title } from "@edenapp/tablets";
import type { FilesystemLocation, TrashEntry } from "@edenapp/types";
import { createMemo, createSignal, onCleanup } from "solid-js";
import { openFileDetailsDialog } from "../dialogs/FileDetailsDialog";
import { t } from "../i18n";
import { findKeepBothPath } from "./fileTransfers";
import type { FileActivity } from "./useFileActivity";
import { useFileSelection } from "./useFileSelection";

type Position = { left: number; top: number };

const toItem = (entry: TrashEntry): FileItem => ({
  name: entry.name,
  location: entry.original,
  isDirectory: entry.isDirectory,
  isFile: entry.isFile,
  size: entry.size,
  modified: new Date(entry.deletedAt),
});

export function useTrash(options: {
  activity: FileActivity;
  dialogs: DialogController;
  sortItems: (items: FileItem[]) => FileItem[];
}) {
  const { activity, dialogs } = options;
  const [entries, setEntries] = createSignal<TrashEntry[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<unknown>();
  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [scrollToSelected, setScrollToSelected] = createSignal(false);
  const busy = activity.busy;
  let request = 0;

  const refresh = async () => {
    const current = ++request;
    try {
      const next = await eden.fs.trashEntries();
      if (current !== request) return;
      setEntries(next);
      setError(undefined);
    } catch (cause) {
      if (current === request) setError(cause);
    } finally {
      if (current === request) setLoading(false);
    }
  };
  const handleChanged = () => void refresh();
  void eden.fs.subscribe("trash-changed", handleChanged).then(refresh);
  onCleanup(() => {
    request += 1;
    eden.fs.unsubscribe("trash-changed", handleChanged);
  });

  // Entries never change in place, so each id keeps its row.
  const rows = createMemo<Map<string, { entry: TrashEntry; item: FileItem }>>(
    (previous) =>
      new Map(
        entries().map((entry) => [
          entry.id,
          previous?.get(entry.id) ?? { entry, item: toItem(entry) },
        ]),
      ),
  );
  const entryByItem = createMemo(
    () => new Map([...rows().values()].map((row) => [row.item, row.entry])),
  );
  const items = createMemo(() =>
    options.sortItems([...rows().values()].map((row) => row.item)),
  );
  const entryFor = (item: FileItem) => entryByItem().get(item);
  const itemKey = (item: FileItem) => entryFor(item)?.id ?? item.location.path;

  const selection = useFileSelection({
    items,
    getItemKey: itemKey,
    currentPath: () => "trash",
    selectedItem,
    setSelectedItem,
    setScrollToSelected,
  });
  const selectedEntries = () =>
    selection.selectedFiles().flatMap((item) => entryFor(item) ?? []);

  const occupied = (location: FilesystemLocation) =>
    eden.fs.lstat(location).then(
      () => true,
      () => false,
    );

  const askRestoreLocation = async (entry: TrashEntry) => {
    const parent = getParentPath(entry.original.path);
    const atParent = (name: string) => ({
      ...entry.original,
      path: joinPath(parent, name),
    });
    const suggestion = await findKeepBothPath(
      toItem(entry),
      parent,
      t("files.restoredSuffix"),
      (path) => occupied({ ...entry.original, path }),
    );
    const values = await dialogs.form({
      title: t("files.restoreAs"),
      message: t("files.restoreNameConflict", { name: entry.name }),
      fields: [
        {
          kind: "text",
          key: "name",
          label: t("common.name"),
          initialValue: suggestion.split("/").pop(),
          required: true,
          autofocus: true,
        },
      ] as const,
      confirmLabel: t("files.restore"),
      cancelLabel: t("common.cancel"),
      validate: ({ name }) =>
        !name.trim() || name === "." || name === ".." || /[/\0]/.test(name)
          ? t("files.errors.invalidItemName")
          : null,
      onSubmit: async ({ name }) =>
        (await occupied(atParent(name)))
          ? t("files.errors.restoreConflict")
          : null,
    });
    return values ? atParent(values.name) : undefined;
  };

  const restoreEntry = async (entry: TrashEntry) => {
    let location: FilesystemLocation | undefined;
    while (true) {
      const result = await activity.submit(() =>
        eden.fs.trashRestore(entry.id, { location }),
      );
      if (result.status === "restored") return;
      location = await askRestoreLocation(entry);
      if (!location) return "skipped";
    }
  };

  const restore = async (selected: TrashEntry[]) => {
    if (busy()) return;
    await activity.batch("restore", selected, restoreEntry);
    await refresh();
  };

  const confirmDelete = (count: number, emptyAll: boolean) =>
    dialogs.confirm({
      title: emptyAll ? t("files.emptyTrash") : t("files.deletePermanently"),
      message: emptyAll
        ? t("files.emptyTrashConfirmation")
        : t("files.permanentDeleteConfirmation", { count }),
      confirmLabel: emptyAll
        ? t("files.emptyTrash")
        : t("files.deletePermanently"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });

  const deletePermanently = async (selected: TrashEntry[]) => {
    if (busy() || !selected.length) return;
    if (!(await confirmDelete(selected.length, false))) return;
    await activity.batch("delete", selected, async (entry) => {
      await activity.submit(() => eden.fs.trashDelete(entry.id));
    });
    await refresh();
  };

  const empty = async () => {
    if (busy() || !entries().length) return;
    if (!(await confirmDelete(entries().length, true))) return;
    await activity.batch("delete", [{ name: t("files.trash") }], async () => {
      await activity.submit(() => eden.fs.trashEmpty());
    });
  };

  const showDetails = async (item: FileItem) => {
    const entry = entryFor(item);
    if (!entry || busy()) return;
    const action = await openFileDetailsDialog({
      dialogs,
      item,
      deletedAt: entry.deletedAt,
      canRestore: () => !busy(),
    });
    if (action === "restore") await restore([entry]);
  };

  const itemMenu = menu((selected: TrashEntry[]) => [
    title(
      selected.length === 1
        ? selected[0].name
        : t("files.selectedCount", { count: selected.length }),
    ),
    button("restore", t("files.restore"), () => restore(selected), {
      icon: "rotate-ccw",
      disabled: busy(),
    }),
    ...(selected.length === 1
      ? [
          button(
            "details",
            t("files.details"),
            () => {
              const row = rows().get(selected[0].id);
              if (row) void showDetails(row.item);
            },
            { icon: "info", disabled: busy() },
          ),
        ]
      : []),
    separator(),
    button(
      "delete-permanently",
      t("files.deletePermanently"),
      () => deletePermanently(selected),
      { icon: "trash", danger: true, disabled: busy() },
    ),
  ]);
  const emptyMenu = menu(() => [
    title(t("files.trash")),
    button("empty-trash", t("files.emptyTrash"), empty, {
      icon: "trash",
      danger: true,
      disabled: busy() || !entries().length,
    }),
  ]);
  const backgroundMenu = menu(() => [
    title(t("files.trash")),
    button("select-all", t("files.selectAll"), selection.selectAll, {
      icon: "check",
      disabled: busy() || !entries().length,
    }),
    button("refresh", t("files.refresh"), refresh, { icon: "refresh-cw" }),
    separator(),
    button("empty-trash", t("files.emptyTrash"), empty, {
      icon: "trash",
      danger: true,
      disabled: busy() || !entries().length,
    }),
  ]);

  const handleItemClick = (
    item: FileItem,
    event?: MouseEvent | KeyboardEvent,
  ) => {
    if (
      selection.selectionMode() ||
      event?.ctrlKey ||
      event?.metaKey ||
      event?.shiftKey
    )
      selection.toggleItem(item, event);
    else selection.focusItem(item);
  };
  const handleItemContextMenu = (item: FileItem, event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const entry = entryFor(item);
    if (!entry || busy()) return;
    const inSelection = selection.selectedPaths().includes(entry.id);
    if (!inSelection) selection.exit();
    selection.focusItem(item);
    void itemMenu.show(inSelection ? selectedEntries() : [entry], {
      left: event.clientX,
      top: event.clientY,
    });
  };
  const handleBackgroundContextMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (busy() || (event.target as HTMLElement)?.closest(".file-item")) return;
    void backgroundMenu.show(null, { left: event.clientX, top: event.clientY });
  };

  return {
    entries,
    items,
    loading,
    error,
    refresh,
    entryFor,
    itemKey,
    selection,
    selectedItem,
    scrollToSelected,
    busy,
    restoreSelected: async () => {
      await restore(selectedEntries());
      if (!selection.selectedFiles().length) selection.exit();
    },
    deleteSelected: async () => {
      await deletePermanently(selectedEntries());
      if (!selection.selectedFiles().length) selection.exit();
    },
    deleteItem: (item: FileItem) => {
      const entry = entryFor(item);
      if (entry) void deletePermanently([entry]);
    },
    showDetails,
    handleItemClick,
    handleItemContextMenu,
    handleBackgroundContextMenu,
    showEmptyMenu: (position: Position) => {
      if (!busy()) void emptyMenu.show(null, position);
    },
  };
}

export type Trash = ReturnType<typeof useTrash>;

import * as eden from "@edenapp/client";
import { getParentPath, joinPath } from "@edenapp/files-core";
import { createOperation } from "@edenapp/solid-kit";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { button, menu, title } from "@edenapp/tablets";
import type { FilesystemLocation, FilesystemVolume } from "@edenapp/types";
import { createEffect, createSignal, on, onCleanup } from "solid-js";
import { t } from "../i18n";
import { findKeepBothPath } from "./fileTransfers";
import { readTrash, restoreTrashEntry, type TrashEntry } from "./trash";
import type {
  FileFailure,
  ShowFileError,
  ShowFileFailures,
} from "./useFileErrors";
import type { FileOperationProgress } from "./useFileTransfers";

export function useTrash(options: {
  dialogs: DialogController;
  isBusy: () => boolean;
  onChanged: () => void;
  showError: ShowFileError;
  showFailures: ShowFileFailures;
  root: () => FilesystemLocation | undefined;
  volumes: () => FilesystemVolume[];
  active: () => boolean;
}) {
  const operation = createOperation();
  const [entries, setEntries] = createSignal<TrashEntry[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [progress, setProgress] = createSignal<FileOperationProgress | null>(
    null,
  );
  const busy = () => progress() !== null;
  const [error, setError] = createSignal<{
    message: string;
    details: unknown;
  }>();
  let menuLoading = false;
  let request = 0;
  let disposed = false;
  let refreshQueued = false;
  const watches = new Map<
    string,
    { location: FilesystemLocation; watchId: string }
  >();
  const release = (watchId: string) =>
    eden.fs.unwatch(watchId).catch(() => undefined);
  onCleanup(() => {
    disposed = true;
    request += 1;
    eden.fs.unsubscribe("changed", handleChanged);
    for (const watch of watches.values()) void release(watch.watchId);
    watches.clear();
  });

  const synchronizeWatches = async (
    locations: FilesystemLocation[],
    current: number,
  ) => {
    let added = false;
    const desired = new Map(
      locations
        .filter((location) =>
          options
            .volumes()
            .some(
              (volume) =>
                volume.id === location.volume &&
                volume.state === "ready" &&
                volume.supportsWatch,
            ),
        )
        .map((location) => [`${location.volume}:${location.path}`, location]),
    );
    for (const [key, watch] of watches) {
      if (disposed || current !== request) return;
      if (desired.has(key)) continue;
      watches.delete(key);
      await release(watch.watchId);
    }
    for (const [key, location] of desired) {
      if (disposed || current !== request) return;
      if (watches.has(key)) continue;
      try {
        const watch = await eden.fs.watch(location);
        if (disposed || current !== request) {
          await release(watch.watchId);
          return;
        }
        watches.set(key, { location, watchId: watch.watchId });
        added = true;
      } catch (error) {
        // A shared entry can disappear between scanning and watch acquisition.
        const exists = await eden.fs.exists(location).catch(() => false);
        if (exists && !disposed && current === request)
          setError({
            message: t("files.errors.loadTrashFailed"),
            details: error,
          });
      }
    }
    return added;
  };

  const handleChanged = (event: { watchId: string; kind: string }) => {
    const watched = [...watches].find(
      ([, watch]) => watch.watchId === event.watchId,
    );
    if (!watched || disposed || !options.active()) return;
    if (event.kind !== "change") {
      watches.delete(watched[0]);
      if (event.kind !== "volume-removed") void release(event.watchId);
    }
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(() => {
      refreshQueued = false;
      if (!disposed && options.active()) void refresh(true);
    });
  };
  const subscribed = eden.fs.subscribe("changed", handleChanged);

  const refresh = async (background = false) => {
    const current = ++request;
    if (!options.active()) {
      await synchronizeWatches([], current);
      setLoading(false);
      return;
    }
    if (!background) setLoading(true);
    setError(undefined);
    try {
      await subscribed;
      const root = options.root();
      if (!root) return;
      const result = await readTrash(root);
      if (!disposed && current === request) {
        setEntries((previous) => {
          const existing = new Map(
            previous.map((entry) => [
              `${entry.directory.volume}:${entry.directory.path}`,
              entry,
            ]),
          );
          return result.entries.map((entry) => {
            const prior = existing.get(
              `${entry.directory.volume}:${entry.directory.path}`,
            );
            // Preserve unchanged row nodes while shared Trash updates arrive.
            return prior &&
              prior.name === entry.name &&
              prior.deletedAt === entry.deletedAt &&
              prior.isDirectory === entry.isDirectory &&
              prior.isFile === entry.isFile &&
              prior.size === entry.size &&
              prior.original.volume === entry.original.volume &&
              prior.original.path === entry.original.path
              ? prior
              : entry;
          });
        });
        if (result.errors.length)
          setError({
            message: t("files.errors.loadTrashFailed"),
            details: result.errors.join("\n"),
          });
        const addedWatches = await synchronizeWatches(
          result.directories,
          current,
        );
        // Read once more after acquiring new watches, closing the gap between
        // the directory snapshot and watch registration.
        if (addedWatches && !disposed && current === request) {
          queueMicrotask(() => {
            if (!disposed && options.active()) void refresh(true);
          });
        }
      }
    } catch (error) {
      if (!disposed && current === request) {
        setEntries([]);
        setError({
          message: t("files.errors.loadTrashFailed"),
          details: error,
        });
      }
    } finally {
      if (!disposed && current === request) setLoading(false);
    }
  };

  createEffect(
    on([options.active, options.root], () => {
      void refresh();
    }),
  );

  const remove = (entry: TrashEntry["directory"]) =>
    operation.run(() => eden.fs.delete(entry));

  const canModify = (entry: TrashEntry) =>
    options
      .volumes()
      .some(
        (volume) =>
          volume.id === entry.directory.volume &&
          volume.state === "ready" &&
          !volume.readOnly,
      );
  const run = async (
    action: "restore" | "delete",
    selected: TrashEntry[],
    process: (entry: TrashEntry) => Promise<boolean>,
  ) => {
    if (busy() || options.isBusy() || disposed) return;
    selected = selected.filter(canModify);
    if (!selected.length) return;
    try {
      const failures: FileFailure[] = [];
      let succeeded = 0;
      for (const [index, entry] of selected.entries()) {
        if (disposed) break;
        setProgress({
          operation: action,
          current: index + 1,
          total: selected.length,
          itemName: entry.name,
        });
        try {
          if (await process(entry)) succeeded += 1;
        } catch (error) {
          failures.push({ name: entry.name, error });
        }
      }
      if (!disposed) await options.showFailures(failures, succeeded);
    } finally {
      setProgress(null);
      if (!disposed) {
        options.onChanged();
        await refresh(true);
      }
    }
  };

  // lstat also recognizes occupied names that are dangling or looping links.
  const entryExists = (location: FilesystemLocation) =>
    eden.fs.lstat(location).then(
      () => true,
      () => false,
    );

  const restoreEntry = async (entry: TrashEntry) => {
    let destination = entry.original;
    while (!disposed) {
      try {
        await restoreTrashEntry(
          entry,
          (from, to) => operation.run(() => eden.fs.mv(from, to)),
          remove,
          destination,
        );
        return true;
      } catch (error) {
        if (
          !(await entryExists(entry.content)) ||
          !(await entryExists(destination))
        )
          throw error;
        const parent = getParentPath(entry.original.path);
        const suggestion = await findKeepBothPath(
          entry,
          parent,
          t("files.restoredSuffix"),
          (path) => entryExists({ ...entry.original, path }),
        );
        if (disposed) return false;
        const values = await options.dialogs.form({
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
            (await entryExists({
              ...entry.original,
              path: joinPath(parent, name),
            }))
              ? t("files.errors.restoreConflict")
              : null,
        });
        if (!values || disposed) return false;
        destination = {
          ...entry.original,
          path: joinPath(parent, values.name),
        };
      }
    }
    return false;
  };

  const restoreMany = (selected: TrashEntry[]) =>
    run("restore", selected, restoreEntry);

  const restore = (entry: TrashEntry) => restoreMany([entry]);

  const deletePermanently = async (selected: TrashEntry[], empty = false) => {
    selected = selected.filter(canModify);
    if (!selected.length || busy() || options.isBusy()) return;
    const confirmed = await options.dialogs.confirm({
      title: empty ? t("files.emptyTrash") : t("files.deletePermanently"),
      message: t("files.permanentDeleteConfirmation", {
        count: selected.length,
      }),
      confirmLabel: empty
        ? t("files.emptyTrash")
        : t("files.deletePermanently"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });
    if (!confirmed) return;
    await run("delete", selected, async (entry) => {
      await remove(entry.directory);
      return true;
    });
  };

  const sidebarMenu = menu((entries: TrashEntry[]) => [
    title(t("files.trash")),
    button(
      "empty-trash",
      t("files.emptyTrash"),
      () => deletePermanently(entries, true),
      {
        icon: "trash",
        danger: true,
        disabled: busy() || options.isBusy() || !entries.some(canModify),
      },
    ),
  ]);
  const showSidebarMenu = async (
    root: FilesystemLocation | undefined,
    position: { left: number; top: number },
  ) => {
    if (!root || disposed || busy() || options.isBusy() || menuLoading) return;
    menuLoading = true;
    try {
      const result = await readTrash(root);
      if (disposed) return;
      await sidebarMenu.show(result.entries, position);
      if (!disposed && result.errors.length) {
        options.showError(
          t("files.errors.loadTrashFailed"),
          result.errors.join("\n"),
        );
      }
    } catch (error) {
      if (!disposed)
        options.showError(t("files.errors.loadTrashFailed"), error);
    } finally {
      menuLoading = false;
    }
  };

  return {
    entries,
    loading,
    busy,
    progress,
    snapshot: () => (operation.pending() ? operation.snapshot() : undefined),
    error,
    refresh,
    restore,
    restoreMany,
    deletePermanently,
    canModify,
    showSidebarMenu,
  };
}

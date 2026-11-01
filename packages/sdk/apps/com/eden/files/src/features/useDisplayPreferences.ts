import * as eden from "@edenapp/client";
import type { DisplayPreferences, FileItem } from "@edenapp/files-core";
import { createMemo, createSignal } from "solid-js";

export function useDisplayPreferences(options: { onChange: () => void }) {
  const [preferences, setPreferences] = createSignal<DisplayPreferences>({
    viewStyle: "grid",
    itemSize: "medium",
    sortBy: "name",
    sortOrder: "asc",
  });
  const [showOptions, setShowOptions] = createSignal(false);
  const [trashSort, setTrashSort] = createSignal<
    Pick<DisplayPreferences, "sortBy" | "sortOrder">
  >({ sortBy: "modified", sortOrder: "desc" });
  const trashPreferences = createMemo(() => ({
    ...preferences(),
    ...trashSort(),
  }));

  const sortItems = (
    items: FileItem[],
    prefs = preferences(),
    foldersFirst = true,
  ): FileItem[] => {
    return [...items].sort((a, b) => {
      if (foldersFirst && a.isDirectory !== b.isDirectory)
        return a.isDirectory ? -1 : 1;

      let comparison = 0;
      switch (prefs.sortBy) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "size":
          comparison = a.size - b.size;
          break;
        case "modified":
          comparison = a.modified.getTime() - b.modified.getTime();
          break;
      }
      return prefs.sortOrder === "asc" ? comparison : -comparison;
    });
  };

  const load = async () => {
    try {
      const result = await eden.db.get("display-preferences");
      if (result.value) {
        const { trashSort: savedTrashSort, ...saved } = JSON.parse(
          result.value,
        );
        setPreferences(saved);
        if (savedTrashSort) setTrashSort(savedTrashSort);
      }
    } catch (error) {
      console.error("Failed to load display preferences:", error);
    }
  };

  const change = async (next: DisplayPreferences, forTrash = false) => {
    if (forTrash) {
      setTrashSort({ sortBy: next.sortBy, sortOrder: next.sortOrder });
      setPreferences((previous) => ({
        ...next,
        sortBy: previous.sortBy,
        sortOrder: previous.sortOrder,
      }));
    } else setPreferences(next);
    options.onChange();
    try {
      await eden.db.set(
        "display-preferences",
        JSON.stringify({ ...preferences(), trashSort: trashSort() }),
      );
    } catch (error) {
      console.error("Failed to save display preferences:", error);
    }
  };

  return {
    preferences,
    trashPreferences,
    sortItems,
    sortTrashItems: (items: FileItem[]) =>
      sortItems(items, trashPreferences(), false),
    load,
    change,
    showOptions,
    openOptions: () => setShowOptions(true),
    closeOptions: () => setShowOptions(false),
  };
}

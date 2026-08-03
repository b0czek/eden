import type { FileItem } from "@edenapp/files-core";
import type { Accessor, Setter } from "solid-js";
import { createEffect, createMemo, createSignal } from "solid-js";

interface UseFileSelectionOptions {
  items: Accessor<FileItem[]>;
  currentPath: Accessor<string>;
  selectedItem: Accessor<string | null>;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
}

export const useFileSelection = (options: UseFileSelectionOptions) => {
  const [selectionMode, setSelectionMode] = createSignal(false);
  const [selectedPaths, setSelectedPaths] = createSignal<string[]>([]);
  const [selectionAnchor, setSelectionAnchor] = createSignal<string | null>(
    null,
  );

  const clear = () => {
    setSelectionMode(false);
    setSelectedPaths([]);
    setSelectionAnchor(null);
  };

  const exit = () => {
    clear();
    options.setSelectedItem(null);
  };

  const start = () => {
    const currentSelection = options.selectedItem();
    setSelectionMode(true);
    setSelectedPaths(
      currentSelection &&
        options.items().some((item) => item.path === currentSelection)
        ? [currentSelection]
        : [],
    );
    setSelectionAnchor(currentSelection);
  };

  const focusItem = (item: FileItem) => {
    options.setScrollToSelected(false);
    options.setSelectedItem(item.path);
  };

  const toggleItem = (item: FileItem, event?: MouseEvent | KeyboardEvent) => {
    const paths = selectionMode()
      ? selectedPaths()
      : options.selectedItem()
        ? [options.selectedItem() as string]
        : [];
    const additive = Boolean(event?.ctrlKey || event?.metaKey);

    if (event?.shiftKey) {
      const anchorPath =
        selectionAnchor() ?? options.selectedItem() ?? item.path;
      const anchorIndex = options
        .items()
        .findIndex((candidate) => candidate.path === anchorPath);
      const itemIndex = options
        .items()
        .findIndex((candidate) => candidate.path === item.path);
      const startIndex = Math.max(0, Math.min(anchorIndex, itemIndex));
      const endIndex = Math.max(anchorIndex, itemIndex);
      const range = options
        .items()
        .slice(startIndex, endIndex + 1)
        .map((candidate) => candidate.path);
      setSelectedPaths(
        additive ? Array.from(new Set([...paths, ...range])) : range,
      );
      setSelectionAnchor(anchorPath);
    } else {
      setSelectedPaths(
        paths.includes(item.path)
          ? paths.filter((path) => path !== item.path)
          : [...paths, item.path],
      );
      setSelectionAnchor(item.path);
    }

    setSelectionMode(true);
    focusItem(item);
  };

  const selectAll = () => {
    setSelectionMode(true);
    setSelectedPaths(options.items().map((item) => item.path));
    const firstItem = options.items()[0];
    if (firstItem) {
      setSelectionAnchor(firstItem.path);
      focusItem(firstItem);
    }
  };

  const allItemsSelected = createMemo(
    () =>
      options.items().length > 0 &&
      selectedPaths().length === options.items().length,
  );

  const toggleAll = () => {
    if (!allItemsSelected()) {
      selectAll();
      return;
    }
    setSelectedPaths([]);
    setSelectionAnchor(null);
    options.setSelectedItem(null);
  };

  const selectedFiles = createMemo(() => {
    const selected = new Set(selectedPaths());
    return options.items().filter((item) => selected.has(item.path));
  });

  let selectionPath = options.currentPath();
  createEffect(() => {
    const nextPath = options.currentPath();
    if (nextPath !== selectionPath) {
      clear();
      selectionPath = nextPath;
    }
  });

  createEffect(() => {
    if (!selectionMode()) return;
    const availablePaths = new Set(options.items().map((item) => item.path));
    setSelectedPaths((paths) =>
      paths.filter((path) => availablePaths.has(path)),
    );
  });

  return {
    selectionMode,
    selectedPaths,
    selectedFiles,
    allItemsSelected,
    clear,
    exit,
    start,
    focusItem,
    toggleItem,
    selectAll,
    toggleAll,
  };
};

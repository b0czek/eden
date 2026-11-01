import type { FileItem } from "@edenapp/files-core";
import type { Accessor, Setter } from "solid-js";
import { createEffect, createMemo, createSignal, on } from "solid-js";

interface UseFileSelectionOptions {
  items: Accessor<FileItem[]>;
  getItemKey?: (item: FileItem) => string;
  currentPath: Accessor<string>;
  selectedItem: Accessor<string | null>;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
}

export const useFileSelection = (options: UseFileSelectionOptions) => {
  const key = (item: FileItem) =>
    options.getItemKey?.(item) ?? item.location.path;
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
        options.items().some((item) => key(item) === currentSelection)
        ? [currentSelection]
        : [],
    );
    setSelectionAnchor(currentSelection);
  };

  const focusItem = (item: FileItem) => {
    options.setScrollToSelected(false);
    options.setSelectedItem(key(item));
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
        selectionAnchor() ?? options.selectedItem() ?? key(item);
      const anchorIndex = options
        .items()
        .findIndex((candidate) => key(candidate) === anchorPath);
      const itemIndex = options
        .items()
        .findIndex((candidate) => key(candidate) === key(item));
      const startIndex = Math.max(0, Math.min(anchorIndex, itemIndex));
      const endIndex = Math.max(anchorIndex, itemIndex);
      const range = options
        .items()
        .slice(startIndex, endIndex + 1)
        .map((candidate) => key(candidate));
      setSelectedPaths(
        additive ? Array.from(new Set([...paths, ...range])) : range,
      );
      setSelectionAnchor(anchorPath);
    } else {
      setSelectedPaths(
        paths.includes(key(item))
          ? paths.filter((path) => path !== key(item))
          : [...paths, key(item)],
      );
      setSelectionAnchor(key(item));
    }

    setSelectionMode(true);
    focusItem(item);
  };

  const selectAll = () => {
    setSelectionMode(true);
    setSelectedPaths(options.items().map((item) => key(item)));
    const firstItem = options.items()[0];
    if (firstItem) {
      setSelectionAnchor(key(firstItem));
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
    return options.items().filter((item) => selected.has(key(item)));
  });

  createEffect(on(options.currentPath, clear, { defer: true }));

  createEffect(() => {
    if (!selectionMode()) return;
    const availablePaths = new Set(options.items().map((item) => key(item)));
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

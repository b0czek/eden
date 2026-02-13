import { createEffect, createSignal } from "solid-js";
import type { Setter } from "solid-js";
import type { FileItem } from "../types";
import { getParentPath, joinPath } from "../utils";

interface UseExplorerNavigationOptions {
  sortItems: (items: FileItem[]) => FileItem[];
  onLoadError: (message: string) => void;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
}

export const useExplorerNavigation = (
  options: UseExplorerNavigationOptions,
) => {
  const [currentPath, setCurrentPath] = createSignal("/");
  const [items, setItems] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [navigationHistory, setNavigationHistory] = createSignal<string[]>([
    "/",
  ]);
  const [historyIndex, setHistoryIndex] = createSignal(0);

  const loadDirectory = async (path: string) => {
    try {
      setLoading(true);
      setCurrentPath(path);

      const dirItems = await window.edenAPI.shellCommand("fs/readdir", {
        path,
      });

      const itemsWithStats = await Promise.all(
        dirItems.map(async (name: string) => {
          const itemPath = joinPath(path, name);
          try {
            const stats = await window.edenAPI.shellCommand("fs/stat", {
              path: itemPath,
            });
            return {
              name,
              path: itemPath,
              isDirectory: stats.isDirectory,
              isFile: stats.isFile,
              size: stats.size,
              modified: new Date(stats.mtime),
            };
          } catch {
            return {
              name,
              path: itemPath,
              isDirectory: false,
              isFile: true,
              size: 0,
              modified: new Date(),
            };
          }
        }),
      );

      setItems(options.sortItems(itemsWithStats));
    } catch (error) {
      console.error("Error loading directory:", error);
      options.onLoadError(
        `Failed to load directory: ${(error as Error).message}`,
      );
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    loadDirectory(currentPath());
  });

  const navigateTo = (path: string, selectedItem?: string) => {
    const history = navigationHistory();
    const index = historyIndex();

    if (index === history.length - 1) {
      setNavigationHistory([...history, path]);
      setHistoryIndex(index + 1);
    } else {
      setNavigationHistory([...history.slice(0, index + 1), path]);
      setHistoryIndex(index + 1);
    }

    loadDirectory(path);

    if (selectedItem) {
      options.setScrollToSelected(true);
      options.setSelectedItem(selectedItem);
    }
  };

  const goBack = () => {
    const index = historyIndex();
    if (index > 0) {
      setHistoryIndex(index - 1);
      loadDirectory(navigationHistory()[index - 1]);
    }
  };

  const goForward = () => {
    const history = navigationHistory();
    const index = historyIndex();
    if (index < history.length - 1) {
      setHistoryIndex(index + 1);
      loadDirectory(history[index + 1]);
    }
  };

  const goUp = () => {
    const parentPath = getParentPath(currentPath());
    if (parentPath !== currentPath()) {
      navigateTo(parentPath);
    }
  };

  const refresh = () => {
    loadDirectory(currentPath());
  };

  createEffect(() => {
    const handleMouseButton = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        e.preventDefault();
        goForward();
      }
    };

    document.addEventListener("mousedown", handleMouseButton);
    return () => document.removeEventListener("mousedown", handleMouseButton);
  });

  return {
    currentPath,
    items,
    setItems,
    loading,
    navigationHistory,
    historyIndex,
    loadDirectory,
    navigateTo,
    goBack,
    goForward,
    goUp,
    refresh,
  };
};

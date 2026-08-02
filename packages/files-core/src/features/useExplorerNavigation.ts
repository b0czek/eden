import type { Accessor, Setter } from "solid-js";
import { createEffect, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../types";
import { getParentPath, joinPath } from "../utils";

interface UseExplorerNavigationOptions {
  initialPath?: string;
  active?: Accessor<boolean>;
  sortItems: (items: FileItem[]) => FileItem[];
  onLoadError: (message: string) => void;
  onPathUnavailable?: (path: string, fallbackPath?: string) => void;
  getLoadDirectoryErrorMessage?: (error: Error) => string;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
}

export const useExplorerNavigation = (
  options: UseExplorerNavigationOptions,
) => {
  const initialPath = options.initialPath ?? "/";
  const [currentPath, setCurrentPath] = createSignal(initialPath);
  const [items, setItems] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [navigationHistory, setNavigationHistory] = createSignal<string[]>([
    initialPath,
  ]);
  const [historyIndex, setHistoryIndex] = createSignal(0);
  let watchId: string | undefined;
  let watchedPath: string | undefined;
  let requestSequence = 0;
  let watchRequestSequence = 0;
  let refreshQueued = false;
  let disposed = false;

  const reportLoadError = (error: unknown) => {
    const loadError = error instanceof Error ? error : new Error(String(error));
    options.onLoadError(
      options.getLoadDirectoryErrorMessage?.(loadError) ??
        `Failed to load directory: ${loadError.message}`,
    );
  };

  const stopWatch = async () => {
    watchRequestSequence += 1;
    const staleWatchId = watchId;
    watchId = undefined;
    watchedPath = undefined;
    if (staleWatchId) {
      await window.edenAPI
        .shellCommand("fs/unwatch", { watchId: staleWatchId })
        .catch(() => undefined);
    }
  };

  const establishWatch = async (path: string) => {
    if (options.active && !options.active()) return false;
    if (watchId && watchedPath === path) return true;
    await stopWatch();
    const watchRequest = ++watchRequestSequence;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await window.edenAPI.shellCommand("fs/watch", { path });
        if (
          disposed ||
          watchRequest !== watchRequestSequence ||
          (options.active && !options.active())
        ) {
          await window.edenAPI
            .shellCommand("fs/unwatch", { watchId: result.watchId })
            .catch(() => undefined);
          return false;
        }
        watchId = result.watchId;
        watchedPath = path;
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    reportLoadError(lastError);
    return false;
  };

  const readDirectory = async (path: string): Promise<FileItem[]> => {
    const dirItems = await window.edenAPI.shellCommand("fs/readdir", { path });
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
          return undefined;
        }
      }),
    );
    return options.sortItems(
      itemsWithStats.filter((item): item is FileItem => item !== undefined),
    );
  };

  const findNearestParent = async (unavailablePath: string) => {
    let candidate = getParentPath(unavailablePath);
    while (candidate !== unavailablePath) {
      try {
        const stats = await window.edenAPI.shellCommand("fs/stat", {
          path: candidate,
        });
        if (stats.isDirectory) return candidate;
      } catch {
        // Continue toward the virtual root.
      }
      if (candidate === "/") break;
      candidate = getParentPath(candidate);
    }
    return undefined;
  };

  const loadDirectory = async (
    path: string,
    settings: { background?: boolean; replaceWatch?: boolean } = {},
  ): Promise<boolean> => {
    const request = ++requestSequence;
    if (!settings.background) setLoading(true);
    if (settings.replaceWatch !== false) await establishWatch(path);
    try {
      const nextItems = await readDirectory(path);
      if (request !== requestSequence || disposed) return false;
      setCurrentPath(path);
      setItems(nextItems);
      return true;
    } catch (error) {
      if (request === requestSequence) reportLoadError(error);
      return false;
    } finally {
      if (!settings.background && request === requestSequence)
        setLoading(false);
    }
  };

  const recoverUnavailablePath = async (unavailablePath: string) => {
    await stopWatch();
    const fallbackPath = await findNearestParent(unavailablePath);
    options.onPathUnavailable?.(unavailablePath, fallbackPath);
    if (!fallbackPath) {
      setItems([]);
      setLoading(false);
      return;
    }
    setNavigationHistory((history) =>
      history.map((entry, index) =>
        index === historyIndex() ? fallbackPath : entry,
      ),
    );
    await loadDirectory(fallbackPath);
  };

  const refresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(async () => {
      refreshQueued = false;
      const path = currentPath();
      const loaded = await loadDirectory(path, {
        background: true,
        replaceWatch: false,
      });
      if (!loaded && path === currentPath()) await recoverUnavailablePath(path);
    });
  };

  const handleChanged = (event: {
    watchId: string;
    kind: "change" | "watch-error";
  }) => {
    if (event.watchId !== watchId) return;
    if (event.kind === "watch-error") {
      const path = currentPath();
      void stopWatch()
        .then(() => establishWatch(path))
        .then((watching) => {
          if (!watching && path === currentPath()) refresh();
        });
      return;
    }
    refresh();
  };

  const subscribed = window.edenAPI.subscribe("fs/changed", handleChanged);
  if (!options.active) {
    void subscribed.then(() => {
      if (!disposed) void loadDirectory(initialPath);
    });
  }

  if (options.active) {
    createEffect(() => {
      if (options.active?.()) {
        void subscribed.then(() => {
          if (!disposed && options.active?.())
            void loadDirectory(currentPath());
        });
      } else {
        void stopWatch();
      }
    });
  }

  const navigateTo = (path: string, selectedItem?: string) => {
    const history = navigationHistory();
    const index = historyIndex();
    setNavigationHistory([...history.slice(0, index + 1), path]);
    setHistoryIndex(index + 1);
    void loadDirectory(path);
    if (selectedItem) {
      options.setScrollToSelected(true);
      options.setSelectedItem(selectedItem);
    }
  };

  const resetNavigation = (path: string, selectedItem?: string) => {
    setNavigationHistory([path]);
    setHistoryIndex(0);
    void loadDirectory(path);
    if (selectedItem) {
      options.setScrollToSelected(true);
      options.setSelectedItem(selectedItem);
    }
  };

  const goBack = () => {
    const index = historyIndex();
    if (index > 0) {
      setHistoryIndex(index - 1);
      void loadDirectory(navigationHistory()[index - 1]);
    }
  };
  const goForward = () => {
    const index = historyIndex();
    if (index < navigationHistory().length - 1) {
      setHistoryIndex(index + 1);
      void loadDirectory(navigationHistory()[index + 1]);
    }
  };
  const goUp = () => {
    const parentPath = getParentPath(currentPath());
    if (parentPath !== currentPath()) navigateTo(parentPath);
  };

  const handleMouseButton = (event: MouseEvent) => {
    if (event.button === 3) {
      event.preventDefault();
      goBack();
    } else if (event.button === 4) {
      event.preventDefault();
      goForward();
    }
  };
  document.addEventListener("mousedown", handleMouseButton);
  onCleanup(() => {
    disposed = true;
    requestSequence += 1;
    document.removeEventListener("mousedown", handleMouseButton);
    window.edenAPI.unsubscribe("fs/changed", handleChanged);
    void stopWatch();
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
    resetNavigation,
    goBack,
    goForward,
    goUp,
    refresh,
  };
};

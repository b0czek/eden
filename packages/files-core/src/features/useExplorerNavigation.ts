import type {
  FilesystemChangeKind,
  FilesystemLocation,
  FilesystemVolume,
} from "@edenapp/types";
import type { Accessor, Setter } from "solid-js";
import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import type { FileItem } from "../types";
import { getParentPath, joinPath } from "../utils";

interface UseExplorerNavigationOptions {
  initialLocation?: FilesystemLocation;
  allowedVolumes?: Accessor<string[] | undefined>;
  onVolumeRemoved?: (volume: string) => void;
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
  const initialLocation = options.initialLocation ?? {
    volume: "home",
    path: "/",
  };
  const [currentLocation, setCurrentLocation] =
    createSignal<FilesystemLocation>(initialLocation);
  const currentVolume = createMemo(() => currentLocation().volume);
  const currentPath = createMemo(() => currentLocation().path);
  const [volumeInventory, setVolumeInventory] = createSignal<
    FilesystemVolume[]
  >([]);
  const volumes = createMemo(() =>
    volumeInventory().filter(
      (volume) =>
        !options.allowedVolumes?.() ||
        options.allowedVolumes?.()?.includes(volume.id),
    ),
  );
  const readOnly = () =>
    volumes().find((volume) => volume.id === currentVolume())?.readOnly ?? true;
  const [items, setItems] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [navigationHistory, setNavigationHistory] = createSignal<
    FilesystemLocation[]
  >([initialLocation]);
  const [historyIndex, setHistoryIndex] = createSignal(0);
  let watchId: string | undefined;
  let watchedLocation: FilesystemLocation | undefined;
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
    watchedLocation = undefined;
    if (staleWatchId) {
      await window.edenAPI
        .shellCommand("fs/unwatch", { watchId: staleWatchId })
        .catch(() => undefined);
    }
  };

  const establishWatch = async (location: FilesystemLocation) => {
    const { path, volume } = location;
    if (
      !volumeInventory().find((entry) => entry.id === volume)?.supportsWatch
    ) {
      await stopWatch();
      return false;
    }
    if (options.active && !options.active()) return false;
    if (
      watchId &&
      watchedLocation?.path === path &&
      watchedLocation.volume === volume
    )
      return true;
    await stopWatch();
    if (path !== currentPath() || volume !== currentVolume()) return false;
    const watchRequest = ++watchRequestSequence;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await window.edenAPI.shellCommand("fs/watch", {
          location,
        });
        if (
          disposed ||
          path !== currentPath() ||
          volume !== currentVolume() ||
          watchRequest !== watchRequestSequence ||
          (options.active && !options.active())
        ) {
          await window.edenAPI
            .shellCommand("fs/unwatch", { watchId: result.watchId })
            .catch(() => undefined);
          return false;
        }
        watchId = result.watchId;
        watchedLocation = location;
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    reportLoadError(lastError);
    return false;
  };

  const readDirectory = async (
    location: FilesystemLocation,
  ): Promise<FileItem[]> => {
    const { path, volume } = location;
    const dirItems = await window.edenAPI.shellCommand("fs/readdir", {
      location,
    });
    const itemsWithStats = await Promise.all(
      dirItems.map(async (name: string) => {
        const itemPath = joinPath(path, name);
        try {
          const stats = await window.edenAPI.shellCommand("fs/stat", {
            location: { volume, path: itemPath },
          });
          return {
            name,
            location: { volume, path: itemPath },
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

  const findNearestParent = async (unavailablePath: string, volume: string) => {
    let candidate = getParentPath(unavailablePath);
    while (candidate !== unavailablePath) {
      try {
        const stats = await window.edenAPI.shellCommand("fs/stat", {
          location: { volume, path: candidate },
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
    location: FilesystemLocation,
    settings: { background?: boolean; replaceWatch?: boolean } = {},
  ): Promise<boolean> => {
    const request = ++requestSequence;
    if (!settings.background) setLoading(true);
    if (settings.replaceWatch !== false) await establishWatch(location);
    if (request !== requestSequence || disposed) return false;
    try {
      const nextItems = await readDirectory(location);
      if (request !== requestSequence || disposed) return false;
      setCurrentLocation(location);
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
    const volume = currentVolume();
    await stopWatch();
    const fallbackPath = await findNearestParent(unavailablePath, volume);
    if (
      volume !== currentVolume() ||
      unavailablePath !== currentPath() ||
      disposed
    )
      return;
    options.onPathUnavailable?.(unavailablePath, fallbackPath);
    if (!fallbackPath) {
      setItems([]);
      setLoading(false);
      return;
    }
    setNavigationHistory((history) =>
      history.map((entry, index) =>
        index === historyIndex()
          ? { volume: currentVolume(), path: fallbackPath }
          : entry,
      ),
    );
    setCurrentLocation({ volume, path: fallbackPath });
    await loadDirectory({ volume, path: fallbackPath });
  };

  const refresh = () => {
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(async () => {
      refreshQueued = false;
      const location = currentLocation();
      const path = location.path;
      const loaded = await loadDirectory(location, {
        background: true,
        replaceWatch: !watchId,
      });
      if (
        !loaded &&
        path === currentPath() &&
        location.volume === currentVolume()
      )
        await recoverUnavailablePath(path);
    });
  };

  const handleChanged = (event: {
    watchId: string;
    kind: FilesystemChangeKind;
  }) => {
    if (event.watchId !== watchId) return;
    if (event.kind === "volume-removed") {
      void stopWatch();
      return;
    }
    if (event.kind === "watch-error") {
      const location = currentLocation();
      const path = location.path;
      void stopWatch()
        .then(() => establishWatch(location))
        .then((watching) => {
          if (!watching && path === currentPath()) refresh();
        });
      return;
    }
    refresh();
  };

  let inventoryVersion = 0;
  const handleVolumesChanged = ({
    volumes: inventory,
  }: {
    volumes: FilesystemVolume[];
  }) => {
    inventoryVersion += 1;
    const previous = currentVolume();
    const wasAvailable = volumeInventory().some(
      (volume) => volume.id === previous,
    );
    setVolumeInventory(inventory);
    if (inventory.some((volume) => volume.id === previous)) {
      if (!wasAvailable && (!options.active || options.active())) {
        void loadDirectory(currentLocation());
      }
      return;
    }
    requestSequence += 1;
    setItems([]);
    options.setSelectedItem(null);
    options.setScrollToSelected(false);
    options.onVolumeRemoved?.(previous);
    const available = inventory.filter(
      (volume) =>
        !options.allowedVolumes?.() ||
        options.allowedVolumes?.()?.includes(volume.id),
    );
    const fallback =
      available.find((volume) => volume.id === "home") ?? available[0];
    if (fallback) resetNavigation("/", undefined, fallback.id);
    else {
      void stopWatch();
      setLoading(false);
    }
  };
  const subscribed = Promise.all([
    window.edenAPI.subscribe("fs/changed", handleChanged),
    window.edenAPI.subscribe("fs/volumes-changed", handleVolumesChanged),
  ])
    .then(async () => {
      const version = inventoryVersion;
      const inventory = await window.edenAPI.shellCommand("fs/volumes", {});
      if (!disposed && version === inventoryVersion)
        setVolumeInventory(inventory);
    })
    .catch(reportLoadError);
  if (!options.active) {
    void subscribed.then(() => {
      if (!disposed) void loadDirectory(currentLocation());
    });
  }

  if (options.active) {
    createEffect(() => {
      if (options.active?.()) {
        void subscribed.then(() => {
          if (!disposed && options.active?.())
            void loadDirectory(currentLocation());
        });
      } else {
        void stopWatch();
      }
    });
  }

  const transitionTo = (
    location: FilesystemLocation,
    updateHistory?: () => void,
    selectedItem?: string,
  ) => {
    setCurrentLocation(location);
    setItems([]);
    options.setSelectedItem(null);
    updateHistory?.();
    void loadDirectory(location);
    if (selectedItem) {
      options.setScrollToSelected(true);
      options.setSelectedItem(selectedItem);
    }
  };

  const navigateTo = (
    path: string,
    selectedItem?: string,
    volume = currentVolume(),
  ) => {
    const location = { path, volume };
    transitionTo(
      location,
      () => {
        const history = navigationHistory();
        const index = historyIndex();
        setNavigationHistory([...history.slice(0, index + 1), location]);
        setHistoryIndex(index + 1);
      },
      selectedItem,
    );
  };

  const resetNavigation = (
    path: string,
    selectedItem?: string,
    volume = currentVolume(),
  ) => {
    const location = { path, volume };
    transitionTo(
      location,
      () => {
        setNavigationHistory([location]);
        setHistoryIndex(0);
      },
      selectedItem,
    );
  };

  const goBack = () => {
    const index = historyIndex();
    if (index > 0) {
      setHistoryIndex(index - 1);
      transitionTo(navigationHistory()[index - 1]);
    }
  };
  const goForward = () => {
    const index = historyIndex();
    if (index < navigationHistory().length - 1) {
      setHistoryIndex(index + 1);
      transitionTo(navigationHistory()[index + 1]);
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
    window.edenAPI.unsubscribe("fs/volumes-changed", handleVolumesChanged);
    void stopWatch();
  });

  return {
    currentVolume,
    currentLocation,
    volumes,
    readOnly,
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

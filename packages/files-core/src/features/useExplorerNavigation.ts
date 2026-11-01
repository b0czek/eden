import * as eden from "@edenapp/client";
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
  onLoadError: (message: string, error?: unknown) => void;
  onPathUnavailable?: (path: string, fallbackPath?: string) => void;
  getLoadDirectoryErrorMessage?: (error: Error) => string;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
}

interface NavigationEntry extends FilesystemLocation {
  page?: string;
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
  const [currentPage, setCurrentPage] = createSignal<string>();
  const currentPath = createMemo(() => currentLocation().path);
  const [volumeInventory, setVolumeInventory] = createSignal<
    FilesystemVolume[]
  >([]);
  const [homeScope, setHomeScope] = createSignal<string>();
  const accessScope = (volume = currentVolume()) =>
    volume === "home" ? homeScope() : "/";
  const canNavigate = (path: string, volume = currentVolume()) => {
    const boundary = accessScope(volume);
    return (
      boundary !== undefined &&
      (boundary === "/" || path === boundary || path.startsWith(`${boundary}/`))
    );
  };
  const canGoUp = () =>
    canNavigate(getParentPath(currentPath())) &&
    currentPath() !== accessScope();
  const volumes = createMemo(() =>
    volumeInventory().filter(
      (volume) =>
        !options.allowedVolumes?.() ||
        options.allowedVolumes?.()?.includes(volume.id),
    ),
  );
  const readOnly = () => {
    const volume = volumes().find((volume) => volume.id === currentVolume());
    return !volume || volume.readOnly || volume.state !== "ready";
  };
  const [items, setItems] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [navigationHistory, setNavigationHistory] = createSignal<
    NavigationEntry[]
  >([initialLocation]);
  const [historyIndex, setHistoryIndex] = createSignal(0);
  let watchId: string | undefined;
  let watchedLocation: FilesystemLocation | undefined;
  let requestSequence = 0;
  let navigationSequence = 0;
  let watchRequestSequence = 0;
  let refreshQueued = false;
  let disposed = false;
  let scopesLoaded = false;

  const reportLoadError = (error: unknown) => {
    const loadError = error instanceof Error ? error : new Error(String(error));
    options.onLoadError(
      options.getLoadDirectoryErrorMessage?.(loadError) ??
        `Failed to load directory: ${loadError.message}`,
      error,
    );
  };

  const stopWatch = async () => {
    watchRequestSequence += 1;
    const staleWatchId = watchId;
    watchId = undefined;
    watchedLocation = undefined;
    if (staleWatchId) {
      await eden.fs.unwatch(staleWatchId).catch(() => undefined);
    }
  };

  const establishWatch = async (location: FilesystemLocation) => {
    const { path, volume } = location;
    if (
      !volumeInventory().find(
        (entry) => entry.id === volume && entry.state === "ready",
      )?.supportsWatch
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
        const result = await eden.fs.watch(location);
        if (
          disposed ||
          path !== currentPath() ||
          volume !== currentVolume() ||
          watchRequest !== watchRequestSequence ||
          (options.active && !options.active())
        ) {
          await eden.fs.unwatch(result.watchId).catch(() => undefined);
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
    const dirItems = await eden.fs.readdir(location);
    const itemsWithStats = await Promise.all(
      dirItems.map(async (name: string) => {
        const itemPath = joinPath(path, name);
        try {
          const stats = await eden.fs
            .stat({ volume, path: itemPath })
            .catch(() => eden.fs.lstat({ volume, path: itemPath }));
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
    while (candidate !== unavailablePath && canNavigate(candidate, volume)) {
      try {
        const stats = await eden.fs.stat({ volume, path: candidate });
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
  ): Promise<boolean | undefined> => {
    const request = ++requestSequence;
    await subscribed;
    if (request !== requestSequence || disposed) return;
    if (!settings.background) setLoading(true);
    if (settings.replaceWatch !== false) await establishWatch(location);
    if (request !== requestSequence || disposed) return;
    try {
      const nextItems = await readDirectory(location);
      if (request !== requestSequence || disposed) return;
      setCurrentLocation(location);
      setItems(nextItems);
      return true;
    } catch (error) {
      if (request !== requestSequence || disposed) return;
      reportLoadError(error);
      return false;
    } finally {
      if (!settings.background && request === requestSequence)
        setLoading(false);
    }
  };

  const recoverUnavailablePath = async (
    unavailablePath: string,
    navigation: number,
  ) => {
    if (disposed || navigation !== navigationSequence || currentPage()) return;
    const volume = currentVolume();
    await stopWatch();
    const fallbackPath = await findNearestParent(unavailablePath, volume);
    if (
      volume !== currentVolume() ||
      unavailablePath !== currentPath() ||
      navigation !== navigationSequence ||
      currentPage() ||
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
    if (currentPage()) return;
    if (refreshQueued) return;
    refreshQueued = true;
    queueMicrotask(async () => {
      refreshQueued = false;
      if (currentPage()) return;
      const location = currentLocation();
      const navigation = navigationSequence;
      const path = location.path;
      const loaded = await loadDirectory(location, {
        background: true,
        replaceWatch: !watchId,
      });
      if (
        loaded === false &&
        navigation === navigationSequence &&
        !currentPage() &&
        path === currentPath() &&
        location.volume === currentVolume()
      )
        await recoverUnavailablePath(path, navigation);
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
    const wasReady = volumeInventory().some(
      (volume) => volume.id === previous && volume.state === "ready",
    );
    setVolumeInventory(inventory);
    if (currentPage()) return;
    const selectedVolume = inventory.find((volume) => volume.id === previous);
    if (selectedVolume) {
      if (selectedVolume.state !== "ready") {
        requestSequence += 1;
        void stopWatch();
        setLoading(false);
        return;
      }
      if (scopesLoaded && !wasReady && (!options.active || options.active())) {
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
    if (fallback) navigateToScope(fallback.id);
    else {
      void stopWatch();
      setLoading(false);
    }
  };
  const subscribed = Promise.all([
    eden.fs.subscribe("changed", handleChanged),
    eden.volume.subscribe("changed", handleVolumesChanged),
  ])
    .then(async () => {
      const version = inventoryVersion;
      const [inventory, scope] = await Promise.all([
        eden.volume.list(),
        eden.fs.accessScope("home"),
      ]);
      if (disposed) return;
      setHomeScope(scope.path);
      if (!options.initialLocation) {
        const initial = { volume: "home", path: scope.path };
        setCurrentLocation(initial);
        setNavigationHistory([initial]);
      }
      if (version === inventoryVersion) setVolumeInventory(inventory);
    })
    .catch(reportLoadError)
    .finally(() => {
      scopesLoaded = true;
    });
  if (!options.active) {
    void subscribed.then(() => {
      if (!disposed && !currentPage()) void loadDirectory(currentLocation());
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
    location: NavigationEntry,
    updateHistory?: () => void,
    selectedItem?: string,
  ) => {
    navigationSequence += 1;
    requestSequence += 1;
    setCurrentPage(location.page);
    setCurrentLocation({ volume: location.volume, path: location.path });
    setItems([]);
    options.setSelectedItem(null);
    updateHistory?.();
    if (location.page) {
      setLoading(false);
      void stopWatch();
    } else void loadDirectory(location);
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
    if (!scopesLoaded) {
      void subscribed.then(() => {
        if (!disposed) navigateTo(path, selectedItem, volume);
      });
      return;
    }
    if (!canNavigate(path, volume)) {
      reportLoadError(new Error("Path is outside of the allowed directory"));
      return;
    }
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
    if (!scopesLoaded) {
      void subscribed.then(() => {
        if (!disposed) resetNavigation(path, selectedItem, volume);
      });
      return;
    }
    if (!canNavigate(path, volume)) {
      reportLoadError(new Error("Path is outside of the allowed directory"));
      return;
    }
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

  const navigateToPage = (page: string) => {
    const navigation = ++navigationSequence;
    void subscribed.then(() => {
      if (disposed || navigation !== navigationSequence) return;
      if (currentPage() === page) return;
      const entry: NavigationEntry = { ...currentLocation(), page };
      transitionTo(entry, () => {
        const index = historyIndex();
        setNavigationHistory([
          ...navigationHistory().slice(0, index + 1),
          entry,
        ]);
        setHistoryIndex(index + 1);
      });
    });
  };

  const navigateToScope = (volume: string) => {
    const navigation = ++navigationSequence;
    void subscribed.then(() => {
      if (disposed || navigation !== navigationSequence) return;
      const boundary = accessScope(volume);
      if (boundary !== undefined) resetNavigation(boundary, undefined, volume);
    });
  };

  const navigateToDirectory = async (location: FilesystemLocation) => {
    const navigation = ++navigationSequence;
    try {
      await subscribed;
      if (disposed || navigation !== navigationSequence) return false;
      const stats = await eden.fs.stat(location);
      if (disposed || navigation !== navigationSequence) return false;
      if (!stats.isDirectory) throw new Error("Not a directory");
      navigateTo(location.path, undefined, location.volume);
      return true;
    } catch (error) {
      if (disposed || navigation !== navigationSequence) return false;
      throw error;
    }
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
    if (!canGoUp()) return;
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
    eden.fs.unsubscribe("changed", handleChanged);
    eden.volume.unsubscribe("changed", handleVolumesChanged);
    void stopWatch();
  });

  return {
    currentPage,
    navigateToPage,
    currentVolume,
    currentLocation,
    accessScope,
    canGoUp,
    navigateToScope,
    navigateToDirectory,
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

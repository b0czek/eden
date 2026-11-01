import * as eden from "@edenapp/client";
import {
  type FileItem,
  getParentPath,
  useExplorerNavigation,
} from "@edenapp/files-core";
import { notification } from "@edenapp/tablets";
import type { FilesystemLocation } from "@edenapp/types";
import { createMemo, createSignal } from "solid-js";
import { t } from "../i18n";
import { getTrashRootForPath, isTrashFolder } from "./trash";
import type { ShowFileError } from "./useFileErrors";
import { useFileSelection } from "./useFileSelection";

export function useDirectoryBrowser(options: {
  sortItems: (items: FileItem[]) => FileItem[];
  showError: ShowFileError;
  onVolumeRemoved: (volume: string) => void;
}) {
  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [scrollToSelected, setScrollToSelected] = createSignal(false);
  const navigation = useExplorerNavigation({
    sortItems: options.sortItems,
    onLoadError: options.showError,
    onVolumeRemoved: (volume) => {
      selection.exit();
      options.onVolumeRemoved(volume);
    },
    onPathUnavailable: (path, fallbackPath) => {
      void notification.push(
        t("files.directoryUnavailableTitle"),
        fallbackPath
          ? t("files.directoryUnavailableFallback", { path, fallbackPath })
          : t("files.directoryUnavailable", { path }),
        { type: "warning" },
      );
    },
    getLoadDirectoryErrorMessage: () => t("files.errors.loadDirectoryFailed"),
    setSelectedItem,
    setScrollToSelected,
  });
  const isTrashItem = (item: FileItem) =>
    item.isDirectory && isTrashFolder(item.location);
  const items = createMemo(() =>
    navigation.items().filter((item) => !isTrashItem(item)),
  );
  const selection = useFileSelection({
    items,
    currentPath: navigation.currentPath,
    selectedItem,
    setSelectedItem,
    setScrollToSelected,
  });

  const openTrash = (location?: FilesystemLocation) => {
    selection.exit();
    navigation.navigateToPage("trash", location);
  };
  const navigate = (
    path: string,
    selectedPath?: string,
    volume = navigation.currentVolume(),
  ) => {
    const root = getTrashRootForPath({ volume, path });
    if (root) {
      openTrash(root);
      return;
    }
    selection.clear();
    if (!selectedPath) setSelectedItem(null);
    navigation.navigateTo(path, selectedPath, volume);
  };
  const goBack = () => {
    selection.exit();
    navigation.goBack();
  };
  const goForward = () => {
    selection.exit();
    navigation.goForward();
  };
  const goUp = () => {
    selection.exit();
    navigation.goUp();
  };
  const selectVolume = (volume: string) => {
    selection.exit();
    navigation.navigateToScope(volume);
  };

  const openPath = async (location: FilesystemLocation) => {
    const { path, volume } = location;
    try {
      const stats = await eden.fs.stat(location);
      if (stats.isDirectory) {
        navigate(path, undefined, volume);
      } else if (stats.isFile) {
        navigate(getParentPath(path), path, volume);
      }
    } catch (error) {
      options.showError(t("files.errors.openFailed"), error);
    }
  };
  const openPinnedFolder = async (location: FilesystemLocation) => {
    const root = getTrashRootForPath(location);
    if (root) {
      openTrash(root);
      return;
    }
    try {
      if (await navigation.navigateToDirectory(location)) selection.exit();
    } catch {
      options.showError(t("files.errors.pinnedFolderUnavailable"));
    }
  };

  return {
    navigation,
    items,
    selection,
    selectedItem,
    setSelectedItem,
    scrollToSelected,
    setScrollToSelected,
    isTrashItem,
    navigate,
    openTrash,
    goBack,
    goForward,
    goUp,
    selectVolume,
    openPath,
    openPinnedFolder,
  };
}

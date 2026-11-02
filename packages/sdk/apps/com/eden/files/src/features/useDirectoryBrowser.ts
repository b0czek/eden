import * as eden from "@edenapp/client";
import {
  type FileItem,
  getParentPath,
  useExplorerNavigation,
} from "@edenapp/files-core";
import { notification } from "@edenapp/tablets";
import type { FilesystemLocation } from "@edenapp/types";
import { createSignal } from "solid-js";
import { t } from "../i18n";
import type { ShowFileError } from "./useFileErrors";
import { useFileSelection } from "./useFileSelection";

export const TRASH_PAGE = "trash";

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
  const selection = useFileSelection({
    items: navigation.items,
    currentPath: navigation.currentPath,
    selectedItem,
    setSelectedItem,
    setScrollToSelected,
  });

  const openTrash = () => {
    selection.exit();
    navigation.navigateToPage(TRASH_PAGE);
  };
  const navigate = (
    path: string,
    selectedPath?: string,
    volume = navigation.currentVolume(),
  ) => {
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
    try {
      if (await navigation.navigateToDirectory(location)) selection.exit();
    } catch {
      options.showError(t("files.errors.pinnedFolderUnavailable"));
    }
  };

  return {
    navigation,
    selection,
    selectedItem,
    setSelectedItem,
    scrollToSelected,
    setScrollToSelected,
    trashSelected: () => navigation.currentPage() === TRASH_PAGE,
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

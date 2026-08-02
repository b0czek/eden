import {
  buildBreadcrumbs,
  DisplayOptionsModal,
  type DisplayPreferences,
  FileExplorerHeader,
  type FileExplorerLabels,
  type FileItem,
  FileList,
  getParentPath,
  ITEM_SIZES,
  useExplorerNavigation,
  useFileActivationPreference,
} from "@edenapp/files-core";
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";
import type { Component } from "solid-js";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { useExplorerContextMenus } from "./features/useExplorerContextMenus";
import { useFileActions } from "./features/useFileActions";
import { initLocale, t } from "./i18n";

const getExplorerLabels = (): FileExplorerLabels => ({
  goBack: t("files.goBack"),
  goForward: t("files.goForward"),
  goUp: t("files.goUp"),
  newFolder: t("files.newFolder"),
  newFile: t("files.newFile"),
  settings: t("common.settings"),
  editPath: t("files.editPath"),
  searchPlaceholder: t("files.searchPlaceholder"),
  loading: t("common.loading"),
  empty: t("files.empty"),
  emptyHint: t("files.emptyHint"),
  folder: t("files.folder"),
  delete: t("common.delete"),
  close: t("common.close"),
  displayOptions: t("files.displayOptions"),
  viewStyle: t("files.viewStyle"),
  grid: t("files.grid"),
  list: t("files.list"),
  displaySize: t("files.displaySize"),
  tiny: t("files.tiny"),
  small: t("files.small"),
  medium: t("files.medium"),
  large: t("files.large"),
  huge: t("files.huge"),
  sortBy: t("files.sortBy"),
  name: t("common.name"),
  size: t("common.size"),
  modified: t("files.modified"),
  ascending: t("files.ascending"),
  descending: t("files.descending"),
});

const App: Component = () => {
  const dialogs = createDialogs();
  const openWithSingleClick = useFileActivationPreference();

  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [scrollToSelected, setScrollToSelected] = createSignal(false);
  const [showDisplayOptionsModal, setShowDisplayOptionsModal] =
    createSignal(false);

  const [displayPreferences, setDisplayPreferences] =
    createSignal<DisplayPreferences>({
      viewStyle: "grid",
      itemSize: "medium",
      sortBy: "name",
      sortOrder: "asc",
    });

  const showError = (message: string) => {
    void dialogs.alert({
      title: t("common.error"),
      message,
      okLabel: t("common.ok"),
    });
  };

  const sortItems = (items: FileItem[]): FileItem[] => {
    const prefs = displayPreferences();

    return [...items].sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

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

  const {
    currentPath,
    items,
    setItems,
    loading,
    navigationHistory,
    historyIndex,
    navigateTo,
    goBack,
    goForward,
    goUp,
    refresh,
  } = useExplorerNavigation({
    sortItems,
    onLoadError: showError,
    onPathUnavailable: (path, fallbackPath) => {
      void window.edenAPI.shellCommand("notification/push", {
        title: t("files.directoryUnavailableTitle"),
        message: fallbackPath
          ? t("files.directoryUnavailableFallback", { path, fallbackPath })
          : t("files.directoryUnavailable", { path }),
        type: "warning",
      });
    },
    getLoadDirectoryErrorMessage: (error) =>
      `${t("files.errors.loadDirectoryFailed")}: ${error.message}`,
    setSelectedItem,
    setScrollToSelected,
  });

  const openPathInExplorer = async (path: string) => {
    try {
      const stats = await window.edenAPI.shellCommand("fs/stat", { path });

      if (stats.isDirectory) {
        navigateTo(path);
        return;
      }

      if (stats.isFile) {
        navigateTo(getParentPath(path), path);
      }
    } catch (error) {
      showError(`${t("files.errors.openFailed")}: ${(error as Error).message}`);
    }
  };

  onMount(async () => {
    initLocale();
    try {
      const result = await window.edenAPI.shellCommand("db/get", {
        key: "display-preferences",
      });
      if (result.value) {
        setDisplayPreferences(JSON.parse(result.value));
      }
    } catch (error) {
      console.error("Failed to load display preferences:", error);
    }

    const launchArgs = window.edenAPI.getLaunchArgs();
    if (launchArgs.length > 0) {
      void openPathInExplorer(launchArgs[0]);
    }

    const handleFileOpened = (data: {
      path: string;
      isDirectory: boolean;
      appId: string;
    }) => {
      if (data.path) {
        void openPathInExplorer(data.path);
      }
    };

    await window.edenAPI.subscribe("file/opened", handleFileOpened);
    onCleanup(() => {
      window.edenAPI.unsubscribe("file/opened", handleFileOpened);
    });
  });

  const handlePreferencesChange = async (
    newPreferences: DisplayPreferences,
  ) => {
    setDisplayPreferences(newPreferences);

    const currentItems = items();
    if (currentItems.length > 0) {
      setItems(sortItems(currentItems));
    }

    try {
      await window.edenAPI.shellCommand("db/set", {
        key: "display-preferences",
        value: JSON.stringify(newPreferences),
      });
    } catch (error) {
      console.error("Failed to save display preferences:", error);
    }
  };

  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      const prefs = displayPreferences();
      const sizes = ITEM_SIZES;

      if (
        (e.ctrlKey || e.metaKey) &&
        (e.key === "=" || e.key === "+" || e.key === "-")
      ) {
        e.preventDefault();

        const currentIndex = sizes.indexOf(prefs.itemSize);
        let newIndex = currentIndex;

        if (e.key === "=" || e.key === "+") {
          newIndex = Math.min(currentIndex + 1, sizes.length - 1);
        } else if (e.key === "-") {
          newIndex = Math.max(currentIndex - 1, 0);
        }

        if (newIndex !== currentIndex) {
          handlePreferencesChange({ ...prefs, itemSize: sizes[newIndex] });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  const {
    duplicateItem,
    openItem,
    getOpenWithMenuItems,
    handleItemClick,
    handleItemActivate,
    promptCreateFolder,
    promptCreateFile,
    promptRename,
    promptDelete,
    handleDeleteClick,
    handleDeleteShortcut,
  } = useFileActions({
    currentPath,
    refresh,
    navigateTo,
    showError,
    dialogs,
    setSelectedItem,
    setScrollToSelected,
  });

  const { handleItemContextMenu, handleBackgroundContextMenu } =
    useExplorerContextMenus({
      openItem,
      getOpenWithMenuItems,
      promptRename,
      duplicateItem,
      promptDelete,
      refresh,
      setSelectedItem,
      setScrollToSelected,
      promptCreateFolder,
      promptCreateFile,
    });

  return (
    <div class="file-explorer">
      <FileExplorerHeader
        labels={getExplorerLabels()}
        currentPath={currentPath()}
        historyIndex={historyIndex()}
        historyLength={navigationHistory().length}
        breadcrumbs={buildBreadcrumbs(currentPath())}
        onGoBack={goBack}
        onGoForward={goForward}
        onGoUp={goUp}
        onNavigate={navigateTo}
        onNewFolder={() => {
          void promptCreateFolder();
        }}
        onNewFile={() => {
          void promptCreateFile();
        }}
        onOpenDisplayOptions={() => setShowDisplayOptionsModal(true)}
      />

      <FileList
        labels={getExplorerLabels()}
        loading={loading()}
        items={items()}
        selectedItem={selectedItem()}
        scrollToSelected={scrollToSelected()}
        viewStyle={displayPreferences().viewStyle}
        itemSize={displayPreferences().itemSize}
        onItemClick={handleItemClick}
        onItemActivate={handleItemActivate}
        activateOnSingleClick={openWithSingleClick()}
        onItemContextMenu={handleItemContextMenu}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        onItemDelete={handleDeleteClick}
        onItemDeleteShortcut={handleDeleteShortcut}
        onBack={goBack}
      />

      <DialogHost dialogs={dialogs} />

      <DisplayOptionsModal
        labels={getExplorerLabels()}
        show={showDisplayOptionsModal()}
        preferences={displayPreferences()}
        onClose={() => setShowDisplayOptionsModal(false)}
        onChange={handlePreferencesChange}
      />
    </div>
  );
};

export default App;

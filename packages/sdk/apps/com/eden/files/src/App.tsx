import {
  buildBreadcrumbs,
  DisplayOptionsModal,
  type DisplayPreferences,
  FileExplorerHeader,
  type FileExplorerLabels,
  type FileItem,
  FileList,
  getParentPath,
  useExplorerNavigation,
  useFileActivationPreference,
} from "@edenapp/files-core";
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";
import { FiCheckSquare, FiX } from "solid-icons/fi";
import type { Component } from "solid-js";
import { createSignal, onCleanup, onMount } from "solid-js";
import {
  SelectionActionBar,
  TransferActionBar,
} from "./components/FileModeActionBars";
import { useExplorerContextMenus } from "./features/useExplorerContextMenus";
import { useFileActions } from "./features/useFileActions";
import { useFileSelection } from "./features/useFileSelection";
import { useFilesKeyboardShortcuts } from "./features/useFilesKeyboardShortcuts";
import { useFileTransfers } from "./features/useFileTransfers";
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
  selectItem: t("files.select"),
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

  const selection = useFileSelection({
    items,
    currentPath,
    selectedItem,
    setSelectedItem,
    setScrollToSelected,
  });
  const {
    selectionMode,
    selectedPaths,
    selectedFiles,
    allItemsSelected,
    exit: exitSelectionMode,
    start: startSelectionMode,
    focusItem: setFocusedItem,
    toggleItem: toggleItemSelection,
    selectAll: selectAllItems,
    toggleAll: toggleAllItems,
  } = selection;

  const navigateWithSelectionClear = (path: string, selectedPath?: string) => {
    selection.clear();
    if (!selectedPath) setSelectedItem(null);
    navigateTo(path, selectedPath);
  };
  const goBackWithSelectionClear = () => {
    selection.exit();
    goBack();
  };
  const goForwardWithSelectionClear = () => {
    selection.exit();
    goForward();
  };
  const goUpWithSelectionClear = () => {
    selection.exit();
    goUp();
  };

  const openPathInExplorer = async (path: string) => {
    try {
      const stats = await window.edenAPI.shellCommand("fs/stat", { path });

      if (stats.isDirectory) {
        navigateWithSelectionClear(path);
        return;
      }

      if (stats.isFile) {
        navigateWithSelectionClear(getParentPath(path), path);
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

  const transfers = useFileTransfers({
    refresh,
    dialogs,
  });

  const {
    duplicateItem,
    openItem,
    getOpenWithMenuItems,
    handleItemClick: handleSingleItemClick,
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
    navigateTo: navigateWithSelectionClear,
    showError,
    dialogs,
    setSelectedItem,
    setScrollToSelected,
  });

  const handleExplorerItemClick = (
    item: FileItem,
    event?: MouseEvent | KeyboardEvent,
  ) => {
    if (
      selectionMode() ||
      event?.ctrlKey ||
      event?.metaKey ||
      event?.shiftKey
    ) {
      toggleItemSelection(item, event);
      return;
    }
    handleSingleItemClick(item);
  };

  const startTransfer = (
    operation: "copy" | "move",
    selected = selectedFiles(),
  ) => {
    if (transfers.beginTransfer(operation, selected)) exitSelectionMode();
  };

  const deleteSelected = async () => {
    const selected = selectedFiles();
    if (await transfers.deleteItems(selected)) exitSelectionMode();
  };

  const shortcutItems = () => {
    if (selectionMode()) return selectedFiles();
    const path = selectedItem();
    if (!path) return [];
    const item = items().find((candidate) => candidate.path === path);
    return item ? [item] : [];
  };

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
      copyItem: (item) => {
        startTransfer("copy", [item]);
      },
      moveItem: (item) => {
        startTransfer("move", [item]);
      },
      isBusy: () => transfers.busy() || Boolean(transfers.pendingTransfer()),
      clearSelection: exitSelectionMode,
    });

  useFilesKeyboardShortcuts({
    busy: transfers.busy,
    hasPendingTransfer: () => Boolean(transfers.pendingTransfer()),
    selectionMode,
    selectedCount: () => selectedPaths().length,
    shortcutItems,
    displayPreferences,
    cancelTransfer: transfers.cancelTransfer,
    exitSelection: exitSelectionMode,
    selectAll: selectAllItems,
    startTransfer,
    deleteSelected,
    changePreferences: handlePreferencesChange,
  });

  return (
    <div class="file-explorer">
      <FileExplorerHeader
        labels={getExplorerLabels()}
        currentPath={currentPath()}
        historyIndex={historyIndex()}
        historyLength={navigationHistory().length}
        breadcrumbs={buildBreadcrumbs(currentPath())}
        onGoBack={goBackWithSelectionClear}
        onGoForward={goForwardWithSelectionClear}
        onGoUp={goUpWithSelectionClear}
        onNavigate={navigateWithSelectionClear}
        endActions={
          <button
            type="button"
            class="eden-btn eden-btn-square eden-btn-sm file-select-button"
            aria-label={selectionMode() ? t("files.done") : t("files.select")}
            title={selectionMode() ? t("files.done") : t("files.select")}
            disabled={transfers.busy() || Boolean(transfers.pendingTransfer())}
            onClick={() =>
              selectionMode() ? exitSelectionMode() : startSelectionMode()
            }
          >
            {selectionMode() ? (
              <FiX aria-hidden="true" />
            ) : (
              <FiCheckSquare aria-hidden="true" />
            )}
          </button>
        }
        onNewFolder={() => {
          void promptCreateFolder();
        }}
        onNewFile={() => {
          void promptCreateFile();
        }}
        onOpenDisplayOptions={() => setShowDisplayOptionsModal(true)}
      />

      {selectionMode() && (
        <SelectionActionBar
          selectedCount={selectedPaths().length}
          itemCount={items().length}
          allItemsSelected={allItemsSelected()}
          busy={transfers.busy()}
          onToggleAll={toggleAllItems}
          onTransfer={startTransfer}
          onDelete={() => void deleteSelected()}
        />
      )}

      {(transfers.pendingTransfer() || transfers.progress()) && (
        <TransferActionBar
          pendingTransfer={transfers.pendingTransfer()}
          progress={transfers.progress()}
          busy={transfers.busy()}
          onComplete={() => void transfers.completeTransfer(currentPath())}
          onCancel={transfers.cancelTransfer}
        />
      )}

      <FileList
        labels={getExplorerLabels()}
        loading={loading()}
        items={items()}
        selectedItem={selectedItem()}
        selectedPaths={selectionMode() ? selectedPaths() : undefined}
        selectionMode={selectionMode()}
        scrollToSelected={scrollToSelected()}
        viewStyle={displayPreferences().viewStyle}
        itemSize={displayPreferences().itemSize}
        onItemClick={handleExplorerItemClick}
        onItemFocus={setFocusedItem}
        onSelectionToggle={toggleItemSelection}
        onItemActivate={handleItemActivate}
        activateOnSingleClick={openWithSingleClick()}
        onItemContextMenu={handleItemContextMenu}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        onItemDelete={selectionMode() ? undefined : handleDeleteClick}
        onItemDeleteShortcut={
          selectionMode() ? undefined : handleDeleteShortcut
        }
        onBack={goBackWithSelectionClear}
        disabled={transfers.busy()}
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

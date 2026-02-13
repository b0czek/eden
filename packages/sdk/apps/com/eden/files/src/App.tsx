import type { Component } from "solid-js";
import { createEffect, createSignal, onMount } from "solid-js";
import FileExplorerHeader from "./components/FileExplorerHeader";
import FileList from "./components/FileList";
import { ITEM_SIZES } from "./constants";
import CreateFileDialog from "./dialogs/CreateFileDialog";
import CreateFolderDialog from "./dialogs/CreateFolderDialog";
import DeleteConfirmDialog from "./dialogs/DeleteConfirmDialog";
import DisplayOptionsModal from "./dialogs/DisplayOptionsModal";
import ErrorDialog from "./dialogs/ErrorDialog";
import RenameDialog from "./dialogs/RenameDialog";
import { buildBreadcrumbs } from "./features/breadcrumbs";
import { useExplorerContextMenus } from "./features/useExplorerContextMenus";
import { useExplorerNavigation } from "./features/useExplorerNavigation";
import { useFileActions } from "./features/useFileActions";
import { initLocale } from "./i18n";
import type { DisplayPreferences, FileItem } from "./types";

const App: Component = () => {
  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [scrollToSelected, setScrollToSelected] = createSignal(false);

  const [showNewFolderDialog, setShowNewFolderDialog] = createSignal(false);
  const [showNewFileDialog, setShowNewFileDialog] = createSignal(false);
  const [showRenameDialog, setShowRenameDialog] = createSignal(false);
  const [showDeleteDialog, setShowDeleteDialog] = createSignal(false);
  const [showErrorDialog, setShowErrorDialog] = createSignal(false);
  const [showDisplayOptionsModal, setShowDisplayOptionsModal] =
    createSignal(false);

  const [errorMessage, setErrorMessage] = createSignal("");
  const [itemToRename, setItemToRename] = createSignal<FileItem | null>(null);
  const [itemToDelete, setItemToDelete] = createSignal<FileItem | null>(null);

  const [displayPreferences, setDisplayPreferences] =
    createSignal<DisplayPreferences>({
      viewStyle: "grid",
      itemSize: "medium",
      sortBy: "name",
      sortOrder: "asc",
    });

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorDialog(true);
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
    setSelectedItem,
    setScrollToSelected,
  });

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
    createFolder,
    createFile,
    duplicateItem,
    openItem,
    renameItem,
    confirmDelete,
    handleItemClick,
    handleItemDoubleClick,
    promptRename,
    promptDelete,
    handleDeleteClick,
    handleDeleteShortcut,
  } = useFileActions({
    currentPath,
    refresh,
    navigateTo,
    showError,
    setSelectedItem,
    setScrollToSelected,
    showNewFolderDialog: setShowNewFolderDialog,
    showNewFileDialog: setShowNewFileDialog,
    showRenameDialog: setShowRenameDialog,
    showDeleteDialog: setShowDeleteDialog,
    itemToRename,
    setItemToRename,
    itemToDelete,
    setItemToDelete,
  });

  const { handleItemContextMenu, handleBackgroundContextMenu } =
    useExplorerContextMenus({
      openItem,
      promptRename,
      duplicateItem,
      promptDelete,
      refresh,
      setSelectedItem,
      setScrollToSelected,
      showNewFolderDialog: setShowNewFolderDialog,
      showNewFileDialog: setShowNewFileDialog,
    });

  return (
    <div class="file-explorer">
      <FileExplorerHeader
        currentPath={currentPath()}
        historyIndex={historyIndex()}
        historyLength={navigationHistory().length}
        breadcrumbs={buildBreadcrumbs(currentPath())}
        onGoBack={goBack}
        onGoForward={goForward}
        onGoUp={goUp}
        onNavigate={navigateTo}
        onNewFolder={() => setShowNewFolderDialog(true)}
        onNewFile={() => setShowNewFileDialog(true)}
        onOpenDisplayOptions={() => setShowDisplayOptionsModal(true)}
      />

      <FileList
        loading={loading()}
        items={items()}
        selectedItem={selectedItem()}
        scrollToSelected={scrollToSelected()}
        viewStyle={displayPreferences().viewStyle}
        itemSize={displayPreferences().itemSize}
        onItemClick={handleItemClick}
        onItemDoubleClick={handleItemDoubleClick}
        onItemContextMenu={handleItemContextMenu}
        onBackgroundContextMenu={handleBackgroundContextMenu}
        onItemDelete={handleDeleteClick}
        onItemDeleteShortcut={handleDeleteShortcut}
        onBack={goBack}
      />

      <CreateFolderDialog
        show={showNewFolderDialog()}
        onClose={() => setShowNewFolderDialog(false)}
        onCreate={createFolder}
      />

      <CreateFileDialog
        show={showNewFileDialog()}
        onClose={() => setShowNewFileDialog(false)}
        onCreate={createFile}
      />

      <RenameDialog
        show={showRenameDialog()}
        item={itemToRename()}
        onClose={() => {
          setShowRenameDialog(false);
          setItemToRename(null);
        }}
        onRename={renameItem}
      />

      <DeleteConfirmDialog
        show={showDeleteDialog()}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={confirmDelete}
        item={itemToDelete()}
      />

      <ErrorDialog
        show={showErrorDialog()}
        onClose={() => setShowErrorDialog(false)}
        message={errorMessage()}
      />

      <DisplayOptionsModal
        show={showDisplayOptionsModal()}
        preferences={displayPreferences()}
        onClose={() => setShowDisplayOptionsModal(false)}
        onChange={handlePreferencesChange}
      />
    </div>
  );
};

export default App;

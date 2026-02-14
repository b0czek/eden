import { DialogHost, createDialogs } from "@edenapp/solid-kit/dialogs";
import type { Component } from "solid-js";
import { createEffect, createSignal, onMount } from "solid-js";
import FileExplorerHeader from "./components/FileExplorerHeader";
import FileList from "./components/FileList";
import { ITEM_SIZES } from "./constants";
import DisplayOptionsModal from "./dialogs/DisplayOptionsModal";
import { buildBreadcrumbs } from "./features/breadcrumbs";
import { useExplorerContextMenus } from "./features/useExplorerContextMenus";
import { useExplorerNavigation } from "./features/useExplorerNavigation";
import { useFileActions } from "./features/useFileActions";
import { initLocale, t } from "./i18n";
import type { DisplayPreferences, FileItem } from "./types";

const App: Component = () => {
  const dialogs = createDialogs();

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
    duplicateItem,
    openItem,
    handleItemClick,
    handleItemDoubleClick,
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

      <DialogHost dialogs={dialogs} />

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

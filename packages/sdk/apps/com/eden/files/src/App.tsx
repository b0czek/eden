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
import { initLocale } from "./i18n";
import type { DisplayPreferences, FileItem } from "./types";
import { getParentPath, isValidName, joinPath } from "./utils";

const App: Component = () => {
  const [currentPath, setCurrentPath] = createSignal("/");
  const [items, setItems] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [scrollToSelected, setScrollToSelected] = createSignal(false);
  const [navigationHistory, setNavigationHistory] = createSignal<string[]>([
    "/",
  ]);
  const [historyIndex, setHistoryIndex] = createSignal(0);

  // Modal states
  const [showNewFolderDialog, setShowNewFolderDialog] = createSignal(false);
  const [showNewFileDialog, setShowNewFileDialog] = createSignal(false);
  const [showDeleteDialog, setShowDeleteDialog] = createSignal(false);
  const [showErrorDialog, setShowErrorDialog] = createSignal(false);
  const [showDisplayOptionsModal, setShowDisplayOptionsModal] =
    createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal("");
  const [itemToDelete, setItemToDelete] = createSignal<FileItem | null>(null);

  // Display preferences
  const [displayPreferences, setDisplayPreferences] =
    createSignal<DisplayPreferences>({
      viewStyle: "grid",
      itemSize: "medium",
      sortBy: "name",
      sortOrder: "asc",
    });

  // Load preferences from database on mount
  onMount(async () => {
    initLocale(); // Initialize locale
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
          } catch (_) {
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

      const sorted = sortItems(itemsWithStats);
      setItems(sorted);
    } catch (error) {
      console.error("Error loading directory:", error);
      showError(`Failed to load directory: ${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    loadDirectory(currentPath());
  });

  // Handle keyboard shortcuts (Zoom only - Navigation moved to FileList)
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if input is focused (e.g. Omnibox or dialogs)
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      const prefs = displayPreferences();
      const sizes = ITEM_SIZES;

      // Zoom Controls (Ctrl/Cmd + +/-)
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
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  // Handle mouse button 4/5 for back/forward navigation
  createEffect(() => {
    const handleMouseButton = (e: MouseEvent) => {
      if (e.button === 3) {
        // Mouse button 4 (back)
        e.preventDefault();
        goBack();
      } else if (e.button === 4) {
        // Mouse button 5 (forward)
        e.preventDefault();
        goForward();
      }
    };

    document.addEventListener("mousedown", handleMouseButton);

    return () => {
      document.removeEventListener("mousedown", handleMouseButton);
    };
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

    // If a specific item should be selected, set it after navigation and trigger scroll
    if (selectedItem) {
      setScrollToSelected(true);
      setSelectedItem(selectedItem);
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

  const sortItems = (items: FileItem[]): FileItem[] => {
    const prefs = displayPreferences();

    return [...items].sort((a, b) => {
      // Folders always come first
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;

      // Then sort by selected criteria
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

  const handlePreferencesChange = async (
    newPreferences: DisplayPreferences,
  ) => {
    setDisplayPreferences(newPreferences);
    // Re-sort existing items with new preferences
    const currentItems = items();
    if (currentItems.length > 0) {
      setItems(sortItems(currentItems));
    }

    // Persist preferences to database
    try {
      await window.edenAPI.shellCommand("db/set", {
        key: "display-preferences",
        value: JSON.stringify(newPreferences),
      });
    } catch (error) {
      console.error("Failed to save display preferences:", error);
    }
  };

  const createFolder = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      showError("Invalid folder name");
      return;
    }

    const folderPath = joinPath(currentPath(), trimmedName);

    try {
      await window.edenAPI.shellCommand("fs/mkdir", {
        path: folderPath,
      });
      setShowNewFolderDialog(false);
      refresh();
    } catch (error) {
      showError(`Failed to create folder: ${(error as Error).message}`);
    }
  };

  const createFile = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      showError("Invalid file name");
      return;
    }

    const filePath = joinPath(currentPath(), trimmedName);

    try {
      await window.edenAPI.shellCommand("fs/write", {
        path: filePath,
        content: "",
      });
      setShowNewFileDialog(false);
      refresh();
    } catch (error) {
      showError(`Failed to create file: ${(error as Error).message}`);
    }
  };

  const confirmDelete = async () => {
    const item = itemToDelete();
    if (!item) return;

    try {
      await window.edenAPI.shellCommand("fs/delete", {
        path: item.path,
      });
      setShowDeleteDialog(false);
      setItemToDelete(null);
      refresh();
    } catch (error) {
      showError(`Failed to delete item: ${(error as Error).message}`);
    }
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorDialog(true);
  };

  const handleItemClick = (item: FileItem) => {
    setScrollToSelected(false); // Don't scroll when clicking directly
    setSelectedItem(item.path);
  };

  const handleItemDoubleClick = async (item: FileItem) => {
    if (item.isDirectory) {
      navigateTo(item.path);
    } else {
      // Open files with their registered handler
      try {
        const result = await window.edenAPI.shellCommand("file/open", {
          path: item.path,
        });
        if (!result.success) {
          showError(`Failed to open file: ${result.error}`);
        }
      } catch (error) {
        showError(`Failed to open file: ${(error as Error).message}`);
      }
    }
  };

  const handleDeleteClick = (item: FileItem, e: MouseEvent) => {
    e.stopPropagation();
    setItemToDelete(item);
    setShowDeleteDialog(true);
  };

  const getBreadcrumbs = () => {
    const path = currentPath();
    const parts = path.split("/").filter((p) => p);

    const crumbs = [{ name: "/", path: "/" }];
    let accumulatedPath = "";

    parts.forEach((part) => {
      accumulatedPath += `/${part}`;
      crumbs.push({ name: part, path: accumulatedPath });
    });

    return crumbs;
  };

  return (
    <div class="file-explorer">
      <FileExplorerHeader
        currentPath={currentPath()}
        historyIndex={historyIndex()}
        historyLength={navigationHistory().length}
        breadcrumbs={getBreadcrumbs()}
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
        onItemDelete={handleDeleteClick}
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

import { createSignal, createEffect } from "solid-js";
import type { Component } from "solid-js";
import type { FileItem } from "./types";
import { joinPath, getParentPath, isValidName } from "./utils";
import FileExplorerHeader from "./components/FileExplorerHeader";
import FileList from "./components/FileList";
import StatusBar from "./components/StatusBar";
import CreateFolderDialog from "./dialogs/CreateFolderDialog";
import CreateFileDialog from "./dialogs/CreateFileDialog";
import DeleteConfirmDialog from "./dialogs/DeleteConfirmDialog";
import ErrorDialog from "./dialogs/ErrorDialog";

const App: Component = () => {
  const [currentPath, setCurrentPath] = createSignal("/");
  const [items, setItems] = createSignal<FileItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [selectedItem, setSelectedItem] = createSignal<string | null>(null);
  const [navigationHistory, setNavigationHistory] = createSignal<string[]>([
    "/",
  ]);
  const [historyIndex, setHistoryIndex] = createSignal(0);

  // Modal states
  const [showNewFolderDialog, setShowNewFolderDialog] = createSignal(false);
  const [showNewFileDialog, setShowNewFileDialog] = createSignal(false);
  const [showDeleteDialog, setShowDeleteDialog] = createSignal(false);
  const [showErrorDialog, setShowErrorDialog] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal("");
  const [itemToDelete, setItemToDelete] = createSignal<FileItem | null>(null);

  const loadDirectory = async (path: string) => {
    try {
      setLoading(true);
      setCurrentPath(path);

      const dirItems = await (window as any).edenAPI.shellCommand(
        "fs/readdir",
        { path }
      );

      const itemsWithStats = await Promise.all(
        dirItems.map(async (name: string) => {
          const itemPath = joinPath(path, name);
          try {
            const stats = await (window as any).edenAPI.shellCommand(
              "fs/stat",
              { path: itemPath }
            );
            return {
              name,
              path: itemPath,
              isDirectory: stats.isDirectory,
              isFile: stats.isFile,
              size: stats.size,
              modified: new Date(stats.mtime),
            };
          } catch (error) {
            return {
              name,
              path: itemPath,
              isDirectory: false,
              isFile: true,
              size: 0,
              modified: new Date(),
            };
          }
        })
      );

      const sorted = itemsWithStats.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });

      setItems(sorted);
    } catch (error) {
      console.error("Error loading directory:", error);
      showError("Failed to load directory: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  createEffect(() => {
    loadDirectory(currentPath());
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

    // If a specific item should be selected, set it after navigation
    if (selectedItem) {
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

  const createFolder = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      showError("Invalid folder name");
      return;
    }

    const folderPath = joinPath(currentPath(), trimmedName);

    try {
      await (window as any).edenAPI.shellCommand("fs/mkdir", {
        path: folderPath,
      });
      setShowNewFolderDialog(false);
      refresh();
    } catch (error) {
      showError("Failed to create folder: " + (error as Error).message);
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
      await (window as any).edenAPI.shellCommand("fs/write", {
        path: filePath,
        content: "",
      });
      setShowNewFileDialog(false);
      refresh();
    } catch (error) {
      showError("Failed to create file: " + (error as Error).message);
    }
  };

  const confirmDelete = async () => {
    const item = itemToDelete();
    if (!item) return;

    try {
      await (window as any).edenAPI.shellCommand("fs/delete", {
        path: item.path,
      });
      setShowDeleteDialog(false);
      setItemToDelete(null);
      refresh();
    } catch (error) {
      showError("Failed to delete item: " + (error as Error).message);
    }
  };

  const showError = (message: string) => {
    setErrorMessage(message);
    setShowErrorDialog(true);
  };

  const handleItemClick = (item: FileItem) => {
    setSelectedItem(item.path);
  };

  const handleItemDoubleClick = (item: FileItem) => {
    if (item.isDirectory) {
      navigateTo(item.path);
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
      accumulatedPath += "/" + part;
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
      />

      <FileList
        loading={loading()}
        items={items()}
        selectedItem={selectedItem()}
        onItemClick={handleItemClick}
        onItemDoubleClick={handleItemDoubleClick}
        onItemDelete={handleDeleteClick}
      />

      <StatusBar currentPath={currentPath()} itemCount={items().length} />

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
    </div>
  );
};

export default App;

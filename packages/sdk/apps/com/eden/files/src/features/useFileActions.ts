import type { Accessor, Setter } from "solid-js";
import { t } from "../i18n";
import type { FileItem } from "../types";
import { isValidName, joinPath } from "../utils";

interface UseFileActionsOptions {
  currentPath: Accessor<string>;
  refresh: () => void;
  navigateTo: (path: string) => void;
  showError: (message: string) => void;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
  showNewFolderDialog: Setter<boolean>;
  showNewFileDialog: Setter<boolean>;
  showRenameDialog: Setter<boolean>;
  showDeleteDialog: Setter<boolean>;
  itemToRename: Accessor<FileItem | null>;
  setItemToRename: Setter<FileItem | null>;
  itemToDelete: Accessor<FileItem | null>;
  setItemToDelete: Setter<FileItem | null>;
}

export const useFileActions = (options: UseFileActionsOptions) => {
  const createFolder = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      options.showError("Invalid folder name");
      return;
    }

    const folderPath = joinPath(options.currentPath(), trimmedName);

    try {
      await window.edenAPI.shellCommand("fs/mkdir", {
        path: folderPath,
      });
      options.showNewFolderDialog(false);
      options.refresh();
    } catch (error) {
      options.showError(`Failed to create folder: ${(error as Error).message}`);
    }
  };

  const createFile = async (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      options.showError("Invalid file name");
      return;
    }

    const filePath = joinPath(options.currentPath(), trimmedName);

    try {
      await window.edenAPI.shellCommand("fs/write", {
        path: filePath,
        content: "",
      });
      options.showNewFileDialog(false);
      options.refresh();
    } catch (error) {
      options.showError(`Failed to create file: ${(error as Error).message}`);
    }
  };

  const splitName = (name: string) => {
    const dotIndex = name.lastIndexOf(".");
    if (dotIndex <= 0) {
      return { base: name, extension: "" };
    }

    return {
      base: name.slice(0, dotIndex),
      extension: name.slice(dotIndex),
    };
  };

  const getDuplicateName = (item: FileItem, duplicateIndex: number) => {
    const copySuffix = t("files.copySuffix");
    const suffix =
      duplicateIndex === 1
        ? `-${copySuffix}`
        : `-${copySuffix}-${duplicateIndex}`;

    if (item.isFile) {
      const { base, extension } = splitName(item.name);
      return `${base}${suffix}${extension}`;
    }

    return `${item.name}${suffix}`;
  };

  const duplicateItem = async (item: FileItem) => {
    try {
      let duplicateIndex = 1;
      let targetName = getDuplicateName(item, duplicateIndex);
      let targetPath = joinPath(options.currentPath(), targetName);

      while (
        await window.edenAPI.shellCommand("fs/exists", { path: targetPath })
      ) {
        duplicateIndex += 1;
        targetName = getDuplicateName(item, duplicateIndex);
        targetPath = joinPath(options.currentPath(), targetName);
      }

      await window.edenAPI.shellCommand("fs/cp", {
        from: item.path,
        to: targetPath,
      });

      options.setScrollToSelected(true);
      options.setSelectedItem(targetPath);
      options.refresh();
    } catch (error) {
      options.showError(
        `Failed to duplicate item: ${(error as Error).message}`,
      );
    }
  };

  const openItem = async (item: FileItem) => {
    if (item.isDirectory) {
      options.navigateTo(item.path);
      return;
    }

    try {
      const result = await window.edenAPI.shellCommand("file/open", {
        path: item.path,
      });
      if (!result.success) {
        options.showError(`Failed to open file: ${result.error}`);
      }
    } catch (error) {
      options.showError(`Failed to open file: ${(error as Error).message}`);
    }
  };

  const renameItem = async (name: string) => {
    const item = options.itemToRename();
    if (!item) return;

    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      options.showError("Invalid file or folder name");
      return;
    }

    const targetPath = joinPath(options.currentPath(), trimmedName);

    if (targetPath === item.path) {
      options.showRenameDialog(false);
      options.setItemToRename(null);
      return;
    }

    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        path: targetPath,
      });
      if (exists) {
        options.showError(t("files.itemAlreadyExists"));
        return;
      }

      await window.edenAPI.shellCommand("fs/mv", {
        from: item.path,
        to: targetPath,
      });

      options.showRenameDialog(false);
      options.setItemToRename(null);
      options.setScrollToSelected(true);
      options.setSelectedItem(targetPath);
      options.refresh();
    } catch (error) {
      options.showError(`Failed to rename item: ${(error as Error).message}`);
    }
  };

  const confirmDelete = async () => {
    const item = options.itemToDelete();
    if (!item) return;

    try {
      await window.edenAPI.shellCommand("fs/delete", {
        path: item.path,
      });
      options.showDeleteDialog(false);
      options.setItemToDelete(null);
      options.refresh();
    } catch (error) {
      options.showError(`Failed to delete item: ${(error as Error).message}`);
    }
  };

  const handleItemClick = (item: FileItem) => {
    options.setScrollToSelected(false);
    options.setSelectedItem(item.path);
  };

  const handleItemDoubleClick = async (item: FileItem) => {
    await openItem(item);
  };

  const promptRename = (item: FileItem) => {
    options.setItemToRename(item);
    options.showRenameDialog(true);
  };

  const promptDelete = (item: FileItem) => {
    options.setItemToDelete(item);
    options.showDeleteDialog(true);
  };

  const handleDeleteClick = (item: FileItem, e: MouseEvent) => {
    e.stopPropagation();
    promptDelete(item);
  };

  const handleDeleteShortcut = (item: FileItem) => {
    promptDelete(item);
  };

  return {
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
  };
};

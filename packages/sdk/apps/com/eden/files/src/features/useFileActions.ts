import type { DialogController } from "@edenapp/solid-kit/dialogs";
import type { Accessor, Setter } from "solid-js";
import { t } from "../i18n";
import type { FileItem } from "../types";
import { isValidName, joinPath } from "../utils";

interface UseFileActionsOptions {
  currentPath: Accessor<string>;
  refresh: () => void;
  navigateTo: (path: string) => void;
  showError: (message: string) => void;
  dialogs: DialogController;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
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

  const renameItem = async (item: FileItem, name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      options.showError("Invalid file or folder name");
      return;
    }

    const targetPath = joinPath(options.currentPath(), trimmedName);

    if (targetPath === item.path) {
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

      options.setScrollToSelected(true);
      options.setSelectedItem(targetPath);
      options.refresh();
    } catch (error) {
      options.showError(`Failed to rename item: ${(error as Error).message}`);
    }
  };

  const deleteItem = async (item: FileItem) => {
    try {
      await window.edenAPI.shellCommand("fs/delete", {
        path: item.path,
      });
      options.refresh();
    } catch (error) {
      options.showError(`Failed to delete item: ${(error as Error).message}`);
    }
  };

  const promptCreateFolder = async () => {
    const name = await options.dialogs.prompt({
      title: t("files.newFolder"),
      label: t("common.name"),
      placeholder: `${t("files.newFolder")}...`,
      confirmLabel: t("common.ok"),
      cancelLabel: t("common.cancel"),
    });

    if (name === null) {
      return;
    }

    await createFolder(name);
  };

  const promptCreateFile = async () => {
    const name = await options.dialogs.prompt({
      title: t("files.newFile"),
      label: t("common.name"),
      placeholder: "example.txt",
      hint: t("files.extensionHelp"),
      confirmLabel: t("common.ok"),
      cancelLabel: t("common.cancel"),
    });

    if (name === null) {
      return;
    }

    await createFile(name);
  };

  const promptRename = async (item: FileItem) => {
    const name = await options.dialogs.prompt({
      title: t("files.rename"),
      label: t("common.name"),
      initialValue: item.name,
      confirmLabel: t("files.rename"),
      cancelLabel: t("common.cancel"),
    });

    if (name === null) {
      return;
    }

    await renameItem(item, name);
  };

  const promptDelete = async (item: FileItem) => {
    const confirmed = await options.dialogs.confirm({
      title: t("common.delete"),
      message: t("common.deleteConfirmation", { name: item.name }),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      tone: "danger",
    });

    if (!confirmed) {
      return;
    }

    await deleteItem(item);
  };

  const handleItemClick = (item: FileItem) => {
    options.setScrollToSelected(false);
    options.setSelectedItem(item.path);
  };

  const handleItemDoubleClick = async (item: FileItem) => {
    await openItem(item);
  };

  const handleDeleteClick = (item: FileItem, e: MouseEvent) => {
    e.stopPropagation();
    void promptDelete(item);
  };

  const handleDeleteShortcut = (item: FileItem) => {
    void promptDelete(item);
  };

  return {
    createFolder,
    createFile,
    duplicateItem,
    openItem,
    renameItem,
    deleteItem,
    promptCreateFolder,
    promptCreateFile,
    handleItemClick,
    handleItemDoubleClick,
    promptRename,
    promptDelete,
    handleDeleteClick,
    handleDeleteShortcut,
  };
};

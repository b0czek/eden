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
  const validateName = (
    name: string,
    invalidMessageKey:
      | "files.errors.invalidFolderName"
      | "files.errors.invalidFileName"
      | "files.errors.invalidItemName",
  ) => {
    const trimmedName = name.trim();
    if (!trimmedName || !isValidName(trimmedName)) {
      return t(invalidMessageKey);
    }

    return null;
  };

  const tryCreateFolder = async (name: string): Promise<string | null> => {
    const trimmedName = name.trim();
    const invalid = validateName(trimmedName, "files.errors.invalidFolderName");
    if (invalid) {
      return invalid;
    }

    const folderPath = joinPath(options.currentPath(), trimmedName);

    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        path: folderPath,
      });
      if (exists) {
        return t("files.errors.itemAlreadyExists");
      }

      await window.edenAPI.shellCommand("fs/mkdir", {
        path: folderPath,
      });
      options.refresh();
    } catch (error) {
      return `${t("files.errors.createFolderFailed")}: ${(error as Error).message}`;
    }

    return null;
  };

  const createFolder = async (name: string) => {
    const error = await tryCreateFolder(name);
    if (error) {
      options.showError(error);
    }
  };

  const tryCreateFile = async (name: string): Promise<string | null> => {
    const trimmedName = name.trim();
    const invalid = validateName(trimmedName, "files.errors.invalidFileName");
    if (invalid) {
      return invalid;
    }

    const filePath = joinPath(options.currentPath(), trimmedName);

    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        path: filePath,
      });
      if (exists) {
        return t("files.errors.itemAlreadyExists");
      }

      await window.edenAPI.shellCommand("fs/write", {
        path: filePath,
        content: "",
      });
      options.refresh();
    } catch (error) {
      return `${t("files.errors.createFileFailed")}: ${(error as Error).message}`;
    }

    return null;
  };

  const createFile = async (name: string) => {
    const error = await tryCreateFile(name);
    if (error) {
      options.showError(error);
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
        `${t("files.errors.duplicateFailed")}: ${(error as Error).message}`,
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
        options.showError(`${t("files.errors.openFailed")}: ${result.error}`);
      }
    } catch (error) {
      options.showError(
        `${t("files.errors.openFailed")}: ${(error as Error).message}`,
      );
    }
  };

  const tryRenameItem = async (
    item: FileItem,
    name: string,
  ): Promise<string | null> => {
    const trimmedName = name.trim();
    const invalid = validateName(trimmedName, "files.errors.invalidItemName");
    if (invalid) {
      return invalid;
    }

    const targetPath = joinPath(options.currentPath(), trimmedName);

    if (targetPath === item.path) {
      return null;
    }

    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        path: targetPath,
      });
      if (exists) {
        return t("files.errors.itemAlreadyExists");
      }

      await window.edenAPI.shellCommand("fs/mv", {
        from: item.path,
        to: targetPath,
      });

      options.setScrollToSelected(true);
      options.setSelectedItem(targetPath);
      options.refresh();
    } catch (error) {
      return `${t("files.errors.renameFailed")}: ${(error as Error).message}`;
    }

    return null;
  };

  const renameItem = async (item: FileItem, name: string) => {
    const error = await tryRenameItem(item, name);
    if (error) {
      options.showError(error);
    }
  };

  const deleteItem = async (item: FileItem) => {
    try {
      await window.edenAPI.shellCommand("fs/delete", {
        path: item.path,
      });
      options.refresh();
    } catch (error) {
      options.showError(
        `${t("files.errors.deleteFailed")}: ${(error as Error).message}`,
      );
    }
  };

  const promptCreateFolder = async () => {
    await options.dialogs.form({
      title: t("files.newFolder"),
      fields: [
        {
          kind: "text",
          key: "name",
          label: t("common.name"),
          placeholder: `${t("files.newFolder")}...`,
          required: true,
          autofocus: true,
        },
      ] as const,
      confirmLabel: t("common.ok"),
      cancelLabel: t("common.cancel"),
      validate: (values) =>
        validateName(values.name, "files.errors.invalidFolderName"),
      onSubmit: async (values) => {
        return await tryCreateFolder(values.name);
      },
    });
  };

  const promptCreateFile = async () => {
    await options.dialogs.form({
      title: t("files.newFile"),
      fields: [
        {
          kind: "text",
          key: "name",
          label: t("common.name"),
          placeholder: "example.txt",
          hint: t("files.extensionHelp"),
          required: true,
          autofocus: true,
        },
      ] as const,
      confirmLabel: t("common.ok"),
      cancelLabel: t("common.cancel"),
      validate: (values) =>
        validateName(values.name, "files.errors.invalidFileName"),
      onSubmit: async (values) => {
        return await tryCreateFile(values.name);
      },
    });
  };

  const promptRename = async (item: FileItem) => {
    await options.dialogs.form({
      title: t("files.rename"),
      fields: [
        {
          kind: "text",
          key: "name",
          label: t("common.name"),
          initialValue: item.name,
          required: true,
          autofocus: true,
        },
      ] as const,
      confirmLabel: t("files.rename"),
      cancelLabel: t("common.cancel"),
      validate: (values) =>
        validateName(values.name, "files.errors.invalidItemName"),
      onSubmit: async (values) => {
        return await tryRenameItem(item, values.name);
      },
    });
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

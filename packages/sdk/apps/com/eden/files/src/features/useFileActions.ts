import {
  type FileItem,
  getParentPath,
  isValidName,
  joinPath,
} from "@edenapp/files-core";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { button, type ContextMenuAction, separator } from "@edenapp/tablets";
import type {
  FileHandlerInfo,
  FilesystemLocation,
  RuntimeAppManifest,
} from "@edenapp/types";
import type { Accessor, Setter } from "solid-js";
import { openOpenWithDialog } from "../dialogs/OpenWithDialog";
import { locale, t } from "../i18n";

interface UseFileActionsOptions {
  currentPath: Accessor<string>;
  currentVolume: Accessor<string>;
  refresh: () => void;
  navigateTo: (path: string) => void;
  showError: (message: string) => void;
  dialogs: DialogController;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
}

export const useFileActions = (options: UseFileActionsOptions) => {
  const getLocalizedAppName = (app: RuntimeAppManifest): string => {
    if (typeof app.name === "string") {
      return app.name;
    }

    const currentLocale = locale();
    return (
      app.name[currentLocale] ||
      app.name.en ||
      Object.values(app.name)[0] ||
      app.id
    );
  };

  const getNoOpenWithOptions = (): ContextMenuAction[] => [
    button("open-with-none", t("files.errors.noAppsAvailable"), () => {}, {
      disabled: true,
    }),
  ];

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

  const tryCreateFolder = async (
    name: string,
    directory: FilesystemLocation = {
      volume: options.currentVolume(),
      path: options.currentPath(),
    },
  ): Promise<string | null> => {
    const trimmedName = name.trim();
    const invalid = validateName(trimmedName, "files.errors.invalidFolderName");
    if (invalid) {
      return invalid;
    }

    const folderPath = joinPath(directory.path, trimmedName);

    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        location: { path: folderPath, volume: directory.volume },
      });
      if (exists) {
        return t("files.errors.itemAlreadyExists");
      }

      await window.edenAPI.shellCommand("fs/mkdir", {
        location: { path: folderPath, volume: directory.volume },
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

  const tryCreateFile = async (
    name: string,
    directory: FilesystemLocation = {
      volume: options.currentVolume(),
      path: options.currentPath(),
    },
  ): Promise<string | null> => {
    const trimmedName = name.trim();
    const invalid = validateName(trimmedName, "files.errors.invalidFileName");
    if (invalid) {
      return invalid;
    }

    const filePath = joinPath(directory.path, trimmedName);

    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        location: { path: filePath, volume: directory.volume },
      });
      if (exists) {
        return t("files.errors.itemAlreadyExists");
      }

      await window.edenAPI.shellCommand("fs/write", {
        location: { path: filePath, volume: directory.volume },
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
      let targetPath = joinPath(getParentPath(item.location.path), targetName);

      while (
        await window.edenAPI.shellCommand("fs/exists", {
          location: { path: targetPath, volume: item.location.volume },
        })
      ) {
        duplicateIndex += 1;
        targetName = getDuplicateName(item, duplicateIndex);
        targetPath = joinPath(getParentPath(item.location.path), targetName);
      }

      await window.edenAPI.operations.wait(
        await window.edenAPI.shellCommand("fs/cp", {
          from: item.location,
          to: { volume: item.location.volume, path: targetPath },
        }),
      );

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
      options.navigateTo(item.location.path);
      return;
    }

    try {
      const result = await window.edenAPI.shellCommand("file/open", {
        location: { path: item.location.path, volume: item.location.volume },
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

  const openItemWithApp = async (item: FileItem, appId: string) => {
    try {
      const openResult = await window.edenAPI.shellCommand("file/open-with", {
        location: { path: item.location.path, volume: item.location.volume },
        appId,
      });

      if (!openResult.success) {
        options.showError(
          `${t("files.errors.openFailed")}: ${openResult.error}`,
        );
        return false;
      }

      return true;
    } catch (error) {
      options.showError(
        `${t("files.errors.openFailed")}: ${(error as Error).message}`,
      );
      return false;
    }
  };

  const setItemDefaultHandler = async (item: FileItem, appId: string) => {
    try {
      await window.edenAPI.shellCommand("file/set-default-handler", {
        location: { path: item.location.path, volume: item.location.volume },
        appId,
      });
    } catch (error) {
      options.showError(
        `${t("files.errors.setDefaultHandlerFailed")}: ${(error as Error).message}`,
      );
    }
  };

  const openItemWithDialog = async (item: FileItem) => {
    try {
      const [supportedHandlers, currentHandler, installedApps] =
        await Promise.all([
          window.edenAPI.shellCommand("file/get-supported-handlers", {
            location: {
              path: item.location.path,
              volume: item.location.volume,
            },
          }) as Promise<FileHandlerInfo[]>,
          window.edenAPI.shellCommand("file/get-handler", {
            location: {
              path: item.location.path,
              volume: item.location.volume,
            },
          }) as Promise<{ appId?: string }>,
          window.edenAPI.shellCommand("package/list", {}) as Promise<
            RuntimeAppManifest[]
          >,
        ]);

      const supportedAppIds = new Set(
        supportedHandlers.map((handler) => handler.appId),
      );

      const availableApps = installedApps
        .map((app) => ({
          appId: app.id,
          appName: getLocalizedAppName(app),
          isSuggested: supportedAppIds.has(app.id),
        }))
        .sort((left, right) => {
          if (left.isSuggested !== right.isSuggested) {
            return left.isSuggested ? -1 : 1;
          }

          return left.appName.localeCompare(right.appName);
        });

      const initialAppId =
        availableApps.find((app) => app.appId === currentHandler.appId)
          ?.appId || availableApps[0]?.appId;

      const selection = await openOpenWithDialog({
        dialogs: options.dialogs,
        itemName: item.name,
        apps: availableApps,
        initialAppId,
      });

      if (!selection) {
        return;
      }

      const openSucceeded = await openItemWithApp(item, selection.appId);
      if (openSucceeded && selection.setAsDefault) {
        await setItemDefaultHandler(item, selection.appId);
      }
    } catch (error) {
      options.showError(
        `${t("files.errors.openFailed")}: ${(error as Error).message}`,
      );
    }
  };

  const getOpenWithMenuItems = async (
    item: FileItem,
  ): Promise<ContextMenuAction[]> => {
    if (!item.isFile && !item.isDirectory) {
      return [];
    }

    try {
      const [supportedHandlers] = await Promise.all([
        window.edenAPI.shellCommand("file/get-supported-handlers", {
          location: { path: item.location.path, volume: item.location.volume },
        }) as Promise<FileHandlerInfo[]>,
      ]);
      const menuItems = supportedHandlers
        .map((handler) => ({
          appId: handler.appId,
          appName: handler.appName || handler.appId,
        }))
        .filter(
          (handler, index, handlers) =>
            handlers.findIndex((entry) => entry.appId === handler.appId) ===
            index,
        )
        .sort((a, b) => a.appName.localeCompare(b.appName))
        .map((handler) =>
          button(
            `open-with-${handler.appId}`,
            handler.appName,
            () => {
              void openItemWithApp(item, handler.appId);
            },
            {
              icon: { type: "app", appId: handler.appId },
            },
          ),
        );

      const moreItem = button("open-with-more", t("files.moreApps"), () =>
        openItemWithDialog(item),
      );

      if (menuItems.length === 0) {
        return [moreItem];
      }

      return [...menuItems, separator(), moreItem];
    } catch (error) {
      options.showError(
        `${t("files.errors.openFailed")}: ${(error as Error).message}`,
      );
      return getNoOpenWithOptions();
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

    const targetPath = joinPath(getParentPath(item.location.path), trimmedName);

    if (targetPath === item.location.path) {
      return null;
    }

    try {
      const exists = await window.edenAPI.shellCommand("fs/exists", {
        location: { path: targetPath, volume: item.location.volume },
      });
      if (exists) {
        return t("files.errors.itemAlreadyExists");
      }

      await window.edenAPI.operations.wait(
        await window.edenAPI.shellCommand("fs/mv", {
          from: item.location,
          to: { volume: item.location.volume, path: targetPath },
        }),
      );

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
      await window.edenAPI.operations.wait(
        await window.edenAPI.shellCommand("fs/delete", {
          location: { path: item.location.path, volume: item.location.volume },
        }),
      );
      options.refresh();
    } catch (error) {
      options.showError(
        `${t("files.errors.deleteFailed")}: ${(error as Error).message}`,
      );
    }
  };

  const promptCreateFolder = async () => {
    const directory = {
      volume: options.currentVolume(),
      path: options.currentPath(),
    };
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
        return await tryCreateFolder(values.name, directory);
      },
    });
  };

  const promptCreateFile = async () => {
    const directory = {
      volume: options.currentVolume(),
      path: options.currentPath(),
    };
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
        return await tryCreateFile(values.name, directory);
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
    options.setSelectedItem(item.location.path);
  };

  const handleItemActivate = async (item: FileItem) => {
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
    getOpenWithMenuItems,
    renameItem,
    deleteItem,
    promptCreateFolder,
    promptCreateFile,
    handleItemClick,
    handleItemActivate,
    promptRename,
    promptDelete,
    handleDeleteClick,
    handleDeleteShortcut,
  };
};

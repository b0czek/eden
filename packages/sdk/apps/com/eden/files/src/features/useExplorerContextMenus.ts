import {
  button,
  menu,
  separator,
  submenu,
  title,
  type ContextMenuAction,
  when,
} from "@edenapp/tablets";
import type { Setter } from "solid-js";
import { t } from "../i18n";
import type { FileItem } from "../types";

interface UseExplorerContextMenusOptions {
  openItem: (item: FileItem) => Promise<void>;
  getOpenWithMenuItems: (item: FileItem) => Promise<ContextMenuAction[]>;
  promptRename: (item: FileItem) => Promise<void>;
  duplicateItem: (item: FileItem) => Promise<void>;
  promptDelete: (item: FileItem) => Promise<void>;
  refresh: () => void;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
  promptCreateFolder: () => Promise<void>;
  promptCreateFile: () => Promise<void>;
}

export const useExplorerContextMenus = (
  options: UseExplorerContextMenusOptions,
) => {
  const fileItemMenu = menu(
    (data: { item: FileItem; openWithItems: ContextMenuAction[] }) => [
      title(data.item.name),
      button("open", t("files.open"), () => options.openItem(data.item), {
        icon: "play",
      }),
      when(
        data.item.isFile,
        submenu("open-with", t("files.openWith"), data.openWithItems, {
          icon: "external-link",
        }),
      ),
      button(
        "rename",
        t("files.rename"),
        () => options.promptRename(data.item),
        {
          icon: "edit-2",
        },
      ),
      button(
        "duplicate",
        t("files.duplicate"),
        () => options.duplicateItem(data.item),
        {
          icon: "copy",
        },
      ),
      separator(),
      button(
        "delete",
        t("common.delete"),
        () => options.promptDelete(data.item),
        {
          icon: "trash",
          danger: true,
        },
      ),
    ],
  );

  const emptyAreaMenu = menu<null>(() => [
    button("new-folder", t("files.newFolder"), options.promptCreateFolder, {
      icon: "folder-plus",
    }),
    button("new-file", t("files.newFile"), options.promptCreateFile, {
      icon: "file-plus",
    }),
    separator(),
    button("refresh", t("files.refresh"), options.refresh, {
      icon: "refresh-cw",
    }),
  ]);

  const handleItemContextMenu = async (item: FileItem, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    options.setScrollToSelected(false);
    options.setSelectedItem(item.path);
    const openWithItems = item.isFile
      ? await options.getOpenWithMenuItems(item)
      : [];
    void fileItemMenu.show(
      { item, openWithItems },
      { left: e.clientX, top: e.clientY },
    );
  };

  const handleBackgroundContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if ((e.target as HTMLElement)?.closest(".file-item")) {
      return;
    }
    void emptyAreaMenu.show(null, { left: e.clientX, top: e.clientY });
  };

  return {
    handleItemContextMenu,
    handleBackgroundContextMenu,
  };
};

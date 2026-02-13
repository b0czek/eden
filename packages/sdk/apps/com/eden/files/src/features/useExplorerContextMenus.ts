import { button, menu, separator, title } from "@edenapp/tablets";
import type { Setter } from "solid-js";
import { t } from "../i18n";
import type { FileItem } from "../types";

interface UseExplorerContextMenusOptions {
  openItem: (item: FileItem) => Promise<void>;
  promptRename: (item: FileItem) => void;
  duplicateItem: (item: FileItem) => Promise<void>;
  promptDelete: (item: FileItem) => void;
  refresh: () => void;
  setSelectedItem: Setter<string | null>;
  setScrollToSelected: Setter<boolean>;
  showNewFolderDialog: Setter<boolean>;
  showNewFileDialog: Setter<boolean>;
}

export const useExplorerContextMenus = (
  options: UseExplorerContextMenusOptions,
) => {
  const fileItemMenu = menu((item: FileItem) => [
    title(item.name),
    button("open", t("files.open"), () => options.openItem(item), {
      icon: "play",
    }),
    button("rename", t("files.rename"), () => options.promptRename(item), {
      icon: "edit-2",
    }),
    button(
      "duplicate",
      t("files.duplicate"),
      () => options.duplicateItem(item),
      {
        icon: "copy",
      },
    ),
    separator(),
    button("delete", t("common.delete"), () => options.promptDelete(item), {
      icon: "trash",
      danger: true,
    }),
  ]);

  const emptyAreaMenu = menu<null>(() => [
    button(
      "new-folder",
      t("files.newFolder"),
      () => {
        options.showNewFolderDialog(true);
      },
      {
        icon: "folder-plus",
      },
    ),
    button(
      "new-file",
      t("files.newFile"),
      () => {
        options.showNewFileDialog(true);
      },
      {
        icon: "file-plus",
      },
    ),
    separator(),
    button("refresh", t("files.refresh"), options.refresh, {
      icon: "refresh-cw",
    }),
  ]);

  const handleItemContextMenu = (item: FileItem, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    options.setScrollToSelected(false);
    options.setSelectedItem(item.path);
    void fileItemMenu.show(item, { left: e.clientX, top: e.clientY });
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

import type { FileItem } from "@edenapp/files-core";
import {
  button,
  type ContextMenuAction,
  menu,
  separator,
  submenu,
  title,
  when,
} from "@edenapp/tablets";
import type { FilesystemLocation, FilesystemVolume } from "@edenapp/types";
import type { Setter } from "solid-js";
import { t } from "../i18n";
import type { PinnedFolder } from "./pinnedFolders";

interface UseExplorerContextMenusOptions {
  volumes: () => FilesystemVolume[];
  currentLocation: () => FilesystemLocation;
  findPin: (location: FilesystemLocation) => PinnedFolder | undefined;
  canPin: (location: FilesystemLocation) => boolean;
  pinFolder: (location: FilesystemLocation, label: string) => Promise<void>;
  unpinFolder: (location: FilesystemLocation) => Promise<void>;
  pinCurrentFolder: () => Promise<void>;
  isVolumeEjectPending: (volume: string) => boolean;
  ejectVolume: (volume: FilesystemVolume) => Promise<void>;
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
  copyItem: (item: FileItem) => void;
  moveItem: (item: FileItem) => void;
  isBusy: () => boolean;
  readOnly: () => boolean;
  clearSelection: () => void;
}

export const useExplorerContextMenus = (
  options: UseExplorerContextMenusOptions,
) => {
  const volumeMenu = menu((volume: FilesystemVolume) => {
    const pending =
      options.isVolumeEjectPending(volume.id) || volume.state === "ejecting";
    return [
      title(volume.label),
      button(
        "eject",
        pending ? t("files.ejecting") : t("files.eject"),
        async () => {
          const current = options
            .volumes()
            .find((candidate) => candidate.id === volume.id);
          if (current) await options.ejectVolume(current);
        },
        {
          icon: "log-out",
          disabled: pending,
        },
      ),
    ];
  });

  const showVolumeMenu = (
    volume: FilesystemVolume,
    position: { left: number; top: number },
  ) => {
    if (!volume.supportsEject) return;
    void volumeMenu.show(volume, position);
  };

  const fileItemMenu = menu(
    (data: { item: FileItem; openWithItems: ContextMenuAction[] }) => [
      title(data.item.name),
      button("open", t("files.open"), () => options.openItem(data.item), {
        icon: "play",
      }),
      when(
        data.item.isFile || data.item.isDirectory,
        submenu("open-with", t("files.openWith"), data.openWithItems, {
          icon: "external-link",
        }),
      ),
      separator(),
      when(
        data.item.isDirectory,
        button(
          "pin-folder",
          options.findPin(data.item.location)
            ? t("files.unpinFolder")
            : t("files.pinFolder"),
          () =>
            options.findPin(data.item.location)
              ? options.unpinFolder(data.item.location)
              : options.pinFolder(data.item.location, data.item.name),
          {
            icon: "bookmark",
            disabled:
              !options.findPin(data.item.location) &&
              !options.canPin(data.item.location),
          },
        ),
      ),
      button("copy", t("files.copy"), () => options.copyItem(data.item), {
        icon: "copy",
      }),
      button("move", t("files.move"), () => options.moveItem(data.item), {
        icon: "move",
        disabled: options.readOnly(),
      }),
      separator(),
      button(
        "rename",
        t("files.rename"),
        () => options.promptRename(data.item),
        {
          icon: "edit-2",
          disabled: options.readOnly(),
        },
      ),
      button(
        "duplicate",
        t("files.duplicate"),
        () => options.duplicateItem(data.item),
        {
          icon: "copy",
          disabled: options.readOnly(),
        },
      ),
      separator(),
      button(
        "delete",
        t("common.delete"),
        () => options.promptDelete(data.item),
        {
          icon: "trash",
          disabled: options.readOnly(),
          danger: true,
        },
      ),
    ],
  );

  const emptyAreaMenu = menu<null>(() => [
    when(
      options.currentLocation().path !== "/",
      button(
        "pin-current-folder",
        options.findPin(options.currentLocation())
          ? t("files.unpinFolder")
          : t("files.pinCurrentFolder"),
        () =>
          options.findPin(options.currentLocation())
            ? options.unpinFolder(options.currentLocation())
            : options.pinCurrentFolder(),
        {
          icon: "bookmark",
          disabled:
            !options.findPin(options.currentLocation()) &&
            !options.canPin(options.currentLocation()),
        },
      ),
    ),
    button("new-folder", t("files.newFolder"), options.promptCreateFolder, {
      icon: "folder-plus",
      disabled: options.readOnly(),
    }),
    button("new-file", t("files.newFile"), options.promptCreateFile, {
      icon: "file-plus",
      disabled: options.readOnly(),
    }),
    separator(),
    button("refresh", t("files.refresh"), options.refresh, {
      icon: "refresh-cw",
    }),
  ]);

  const handleItemContextMenu = async (item: FileItem, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (options.isBusy()) return;
    options.clearSelection();
    options.setScrollToSelected(false);
    options.setSelectedItem(item.location.path);
    const openWithItems =
      item.isFile || item.isDirectory
        ? await options.getOpenWithMenuItems(item)
        : [];
    void fileItemMenu.show(
      { item, openWithItems },
      { left: e.clientX, top: e.clientY },
    );
  };

  const handleBackgroundContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (options.isBusy()) return;
    if ((e.target as HTMLElement)?.closest(".file-item")) {
      return;
    }
    options.clearSelection();
    void emptyAreaMenu.show(null, { left: e.clientX, top: e.clientY });
  };

  return {
    showVolumeMenu,
    handleItemContextMenu,
    handleBackgroundContextMenu,
  };
};

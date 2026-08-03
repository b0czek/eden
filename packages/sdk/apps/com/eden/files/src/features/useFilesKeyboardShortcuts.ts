import {
  type DisplayPreferences,
  type FileItem,
  ITEM_SIZES,
} from "@edenapp/files-core";
import type { Accessor } from "solid-js";
import { onCleanup, onMount } from "solid-js";
import type { TransferOperation } from "./fileTransfers";

interface UseFilesKeyboardShortcutsOptions {
  busy: Accessor<boolean>;
  hasPendingTransfer: Accessor<boolean>;
  selectionMode: Accessor<boolean>;
  selectedCount: Accessor<number>;
  shortcutItems: () => FileItem[];
  displayPreferences: Accessor<DisplayPreferences>;
  cancelTransfer: () => void;
  exitSelection: () => void;
  selectAll: () => void;
  startTransfer: (operation: TransferOperation, items: FileItem[]) => void;
  deleteSelected: () => Promise<void>;
  changePreferences: (preferences: DisplayPreferences) => Promise<void>;
}

export const useFilesKeyboardShortcuts = (
  options: UseFilesKeyboardShortcutsOptions,
) => {
  onMount(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable)
      ) {
        return;
      }

      const accelerator = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (event.key === "Escape" && options.hasPendingTransfer()) {
        event.preventDefault();
        options.cancelTransfer();
        return;
      }
      if (event.key === "Escape" && options.selectionMode()) {
        event.preventDefault();
        options.exitSelection();
        return;
      }
      if (
        accelerator &&
        key === "a" &&
        !options.busy() &&
        !options.hasPendingTransfer()
      ) {
        event.preventDefault();
        options.selectAll();
        return;
      }
      if (
        accelerator &&
        (key === "c" || key === "x") &&
        !options.busy() &&
        !options.hasPendingTransfer()
      ) {
        const selected = options.shortcutItems();
        if (selected.length > 0) {
          event.preventDefault();
          options.startTransfer(key === "c" ? "copy" : "move", selected);
        }
        return;
      }
      if (
        event.key === "Delete" &&
        options.selectionMode() &&
        options.selectedCount() > 0 &&
        !options.busy()
      ) {
        event.preventDefault();
        void options.deleteSelected();
        return;
      }

      const preferences = options.displayPreferences();
      if (
        accelerator &&
        (event.key === "=" || event.key === "+" || event.key === "-")
      ) {
        event.preventDefault();
        const currentIndex = ITEM_SIZES.indexOf(preferences.itemSize);
        const newIndex =
          event.key === "-"
            ? Math.max(currentIndex - 1, 0)
            : Math.min(currentIndex + 1, ITEM_SIZES.length - 1);
        if (newIndex !== currentIndex) {
          void options.changePreferences({
            ...preferences,
            itemSize: ITEM_SIZES[newIndex],
          });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });
};

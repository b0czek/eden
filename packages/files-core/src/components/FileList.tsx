import type { Component } from "solid-js";
import { createEffect, For, onCleanup, Show } from "solid-js";
import { fileIcons } from "../fileIcons";
import type {
  FileExplorerLabels,
  FileItem,
  ItemSize,
  ViewStyle,
} from "../types";
import FileGraphic from "./FileGraphic";
import FileItemComponent from "./FileItem";

export interface FileListProps {
  labels: FileExplorerLabels;
  loading: boolean;
  items: FileItem[];
  selectedItem: string | null;
  selectedItems?: string[];
  selectedPaths?: readonly string[];
  selectionMode?: boolean;
  scrollToSelected?: boolean;
  viewStyle: ViewStyle;
  itemSize: ItemSize;
  onItemClick: (item: FileItem, event?: MouseEvent | KeyboardEvent) => void;
  onItemFocus?: (item: FileItem) => void;
  onSelectionToggle?: (
    item: FileItem,
    event?: MouseEvent | KeyboardEvent,
  ) => void;
  onItemActivate: (item: FileItem) => void;
  activateOnSingleClick: boolean;
  canActivateOnClick?: (item: FileItem) => boolean;
  onItemContextMenu?: (item: FileItem, e: MouseEvent) => void;
  onBackgroundContextMenu?: (e: MouseEvent) => void;
  onItemDelete?: (item: FileItem, e: MouseEvent) => void;
  onItemDeleteShortcut?: (item: FileItem) => void;
  onBack?: () => void;
  disabled?: boolean;
}

const FileList: Component<FileListProps> = (props) => {
  const fileRefs: Map<string, HTMLDivElement> = new Map();
  let containerRef: HTMLDivElement | undefined;

  const isItemSelected = (item: FileItem) => {
    const selectedItems = props.selectedPaths ?? props.selectedItems;
    if (selectedItems) {
      return selectedItems.includes(item.path);
    }
    return props.selectedItem === item.path;
  };

  const canActivateOnClick = (item: FileItem) =>
    props.canActivateOnClick?.(item) ?? true;

  const handleItemClick = (
    item: FileItem,
    event: MouseEvent,
    pointerType: string | undefined,
  ) => {
    if (props.disabled) return;
    if (props.selectionMode) {
      props.onItemFocus?.(item);
      (props.onSelectionToggle ?? props.onItemClick)(item, event);
      return;
    }

    props.onItemClick(item, event);
    if (
      !props.selectionMode &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      canActivateOnClick(item) &&
      (pointerType === "touch" || props.activateOnSingleClick)
    ) {
      props.onItemActivate(item);
    }
  };

  const handleItemDoubleClick = (item: FileItem) => {
    if (
      !props.disabled &&
      !props.selectionMode &&
      !props.activateOnSingleClick &&
      canActivateOnClick(item)
    ) {
      props.onItemActivate(item);
    }
  };

  createEffect(() => {
    // Track items to re-run when list updates
    const items = props.items;
    const shouldScroll = props.scrollToSelected;
    const selected = props.selectedItem;

    // Only scroll when explicitly requested (e.g., when selecting from omnibox)
    if (shouldScroll && selected && items.length > 0) {
      // Wait for DOM to update with new refs
      requestAnimationFrame(() => {
        const element = fileRefs.get(selected);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    }
  });

  // Handle keyboard navigation locally to support grid geometry
  createEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if input is focused
      const target = e.target;
      if (
        target instanceof HTMLElement &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
          target.isContentEditable)
      )
        return;
      if (props.disabled) return;

      const items = props.items;
      const selected = props.selectedItem;
      const viewStyle = props.viewStyle;

      if (!items.length) return;

      if (e.key === "Enter" || (props.selectionMode && e.key === " ")) {
        if (selected) {
          e.preventDefault();
          const item = items.find((i) => i.path === selected);
          if (item) {
            if (props.selectionMode) {
              (props.onSelectionToggle ?? props.onItemClick)(item, e);
            } else if (!props.disabled) {
              props.onItemActivate(item);
            }
          }
        }
        return;
      }

      if (e.key === "Backspace") {
        if (props.onBack) {
          e.preventDefault();
          props.onBack();
        }
        return;
      }

      if (e.key === "Delete") {
        if (!props.selectionMode && selected && props.onItemDeleteShortcut) {
          const item = items.find((i) => i.path === selected);
          if (item) {
            e.preventDefault();
            props.onItemDeleteShortcut(item);
          }
        }
        return;
      }

      const navKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!navKeys.includes(e.key)) return;

      e.preventDefault();

      let currentIndex = -1;
      if (selected) {
        currentIndex = items.findIndex((i) => i.path === selected);
      }

      // If nothing selected, select first
      if (currentIndex === -1) {
        if (props.onItemFocus) props.onItemFocus(items[0]);
        else props.onItemClick(items[0]);
        return;
      }

      let nextIndex = currentIndex;
      let columns = 1;

      // Calculate columns if in grid view
      if (viewStyle === "grid" && containerRef) {
        // Robust way to find number of columns using CSS Grid computed styles
        const gridComputedStyle = window.getComputedStyle(containerRef);
        const gridTemplateColumns = gridComputedStyle.getPropertyValue(
          "grid-template-columns",
        );

        if (gridTemplateColumns) {
          // grid-template-columns returns a space-separated string of pixel values (e.g. "200px 200px")
          // We just need to count them to know how many columns there are
          columns = gridTemplateColumns.split(" ").length;
        }
      }

      if (e.key === "ArrowRight") {
        nextIndex = Math.min(currentIndex + 1, items.length - 1);
      } else if (e.key === "ArrowLeft") {
        nextIndex = Math.max(currentIndex - 1, 0);
      } else if (e.key === "ArrowDown") {
        // In grid: +columns. In list: +1
        const stride = viewStyle === "grid" ? columns : 1;
        nextIndex = Math.min(currentIndex + stride, items.length - 1);
      } else if (e.key === "ArrowUp") {
        // In grid: -columns. In list: -1
        const stride = viewStyle === "grid" ? columns : 1;
        nextIndex = Math.max(currentIndex - stride, 0);
      }

      if (nextIndex !== currentIndex && items[nextIndex]) {
        const item = items[nextIndex];
        if (props.onItemFocus) props.onItemFocus(item);
        else props.onItemClick(item);

        // Ensure visibility during keyboard navigation
        // We use immediate scroll since the element already exists
        const el = fileRefs.get(item.path);
        if (el) {
          el.scrollIntoView({ block: "nearest" });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    onCleanup(() => document.removeEventListener("keydown", handleKeyDown));
  });

  return (
    <main
      class="explorer-content"
      onContextMenu={props.onBackgroundContextMenu}
    >
      <Show when={props.loading}>
        <div class="loading-message">{props.labels.loading}</div>
      </Show>

      <Show when={!props.loading && props.items.length === 0}>
        <div class="empty-state">
          <div class="empty-icon">
            <FileGraphic src={fileIcons.openFolder} />
          </div>
          <div class="empty-message">{props.labels.empty}</div>
          <div class="empty-hint">{props.labels.emptyHint}</div>
        </div>
      </Show>

      <Show when={!props.loading && props.items.length > 0}>
        <div
          class="file-list"
          classList={{ "list-view": props.viewStyle === "list" }}
          ref={containerRef}
        >
          <For each={props.items}>
            {(item) => (
              <FileItemComponent
                ref={(el: HTMLDivElement) => fileRefs.set(item.path, el)}
                item={item}
                isSelected={isItemSelected(item)}
                isFocused={props.selectedItem === item.path}
                selectionMode={props.selectionMode}
                disabled={props.disabled}
                viewStyle={props.viewStyle}
                itemSize={props.itemSize}
                labels={props.labels}
                onClick={handleItemClick}
                onDoubleClick={handleItemDoubleClick}
                onContextMenu={props.onItemContextMenu}
                onDelete={props.onItemDelete}
                onSelectionToggle={props.onSelectionToggle}
              />
            )}
          </For>
        </div>
      </Show>
    </main>
  );
};

export { FileList };
export default FileList;

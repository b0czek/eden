import { Show, For, createEffect } from "solid-js";
import type { Component } from "solid-js";
import type { FileItem, ViewStyle, ItemSize } from "../types";
import FileItemComponent from "./FileItem";

import { t } from "../i18n";

interface FileListProps {
  loading: boolean;
  items: FileItem[];
  selectedItem: string | null;
  scrollToSelected?: boolean;
  viewStyle: ViewStyle;
  itemSize: ItemSize;
  onItemClick: (item: FileItem) => void;
  onItemDoubleClick: (item: FileItem) => void;
  onItemDelete: (item: FileItem, e: MouseEvent) => void;
  onBack?: () => void;
}

const FileList: Component<FileListProps> = (props) => {
  let fileRefs: Map<string, HTMLDivElement> = new Map();
  let containerRef: HTMLDivElement | undefined;

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
      if ((e.target as HTMLElement).tagName === "INPUT") return;

      const items = props.items;
      const selected = props.selectedItem;
      const viewStyle = props.viewStyle;

      if (!items.length) return;

      if (e.key === "Enter") {
        if (selected) {
          e.preventDefault();
          const item = items.find((i) => i.path === selected);
          if (item) {
            props.onItemDoubleClick(item);
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

      const navKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
      if (!navKeys.includes(e.key)) return;

      e.preventDefault();

      let currentIndex = -1;
      if (selected) {
        currentIndex = items.findIndex((i) => i.path === selected);
      }

      // If nothing selected, select first
      if (currentIndex === -1) {
        props.onItemClick(items[0]);
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
        props.onItemClick(item);

        // Ensure visibility during keyboard navigation
        // We use immediate scroll since the element already exists
        const el = fileRefs.get(item.path);
        if (el) {
          el.scrollIntoView({ block: "nearest" });
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <main class="explorer-content">
      <Show when={props.loading}>
        <div class="loading-message">{t("common.loading")}</div>
      </Show>

      <Show when={!props.loading && props.items.length === 0}>
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <div class="empty-message">{t("files.empty")}</div>
          <div class="empty-hint">{t("files.emptyHint")}</div>
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
                isSelected={props.selectedItem === item.path}
                viewStyle={props.viewStyle}
                itemSize={props.itemSize}
                onClick={props.onItemClick}
                onDoubleClick={props.onItemDoubleClick}
                onDelete={props.onItemDelete}
              />
            )}
          </For>
        </div>
      </Show>
    </main>
  );
};

export default FileList;

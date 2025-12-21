import { Show, For, createEffect } from "solid-js";
import type { Component } from "solid-js";
import type { FileItem, ViewStyle, ItemSize } from "../types";
import FileItemComponent from "./FileItem";

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
}

const FileList: Component<FileListProps> = (props) => {
  let fileRefs: Map<string, HTMLDivElement> = new Map();

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

  return (
    <main class="explorer-content">
      <Show when={props.loading}>
        <div class="loading-message">Loading...</div>
      </Show>

      <Show when={!props.loading && props.items.length === 0}>
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <div class="empty-message">This folder is empty</div>
          <div class="empty-hint">
            Create a new file or folder to get started
          </div>
        </div>
      </Show>

      <Show when={!props.loading && props.items.length > 0}>
        <div class="file-list" classList={{ 'list-view': props.viewStyle === 'list' }}>
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

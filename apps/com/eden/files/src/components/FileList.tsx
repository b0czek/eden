import { Show, For, createEffect } from "solid-js";
import type { Component } from "solid-js";
import type { FileItem } from "../types";
import FileItemComponent from "./FileItem";

interface FileListProps {
  loading: boolean;
  items: FileItem[];
  selectedItem: string | null;
  onItemClick: (item: FileItem) => void;
  onItemDoubleClick: (item: FileItem) => void;
  onItemDelete: (item: FileItem, e: MouseEvent) => void;
}

const FileList: Component<FileListProps> = (props) => {
  let fileRefs: Map<string, HTMLDivElement> = new Map();

  createEffect(() => {
    const selected = props.selectedItem;
    if (selected) {
      const element = fileRefs.get(selected);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
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
        <div class="file-list">
          <For each={props.items}>
            {(item) => (
              <FileItemComponent
                ref={(el: HTMLDivElement) => fileRefs.set(item.path, el)}
                item={item}
                isSelected={props.selectedItem === item.path}
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

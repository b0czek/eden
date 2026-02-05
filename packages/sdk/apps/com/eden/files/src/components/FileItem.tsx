import type { Component } from "solid-js";
import type { FileItem, ViewStyle, ItemSize } from "../types";
import { getFileIcon, formatFileSize } from "../utils";

interface FileItemComponentProps {
  ref?: (el: HTMLDivElement) => void;
  item: FileItem;
  isSelected: boolean;
  viewStyle: ViewStyle;
  itemSize: ItemSize;
  onClick: (item: FileItem) => void;
  onDoubleClick: (item: FileItem) => void;
  onDelete: (item: FileItem, e: MouseEvent) => void;
}

const FileItemComponent: Component<FileItemComponentProps> = (props) => {
  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  return (
    <div
      ref={props.ref}
      class="file-item"
      classList={{
        selected: props.isSelected,
        "list-view": props.viewStyle === "list",
        [`size-${props.itemSize}`]: true,
      }}
      onClick={() => props.onClick(props.item)}
      onDblClick={() => props.onDoubleClick(props.item)}
    >
      <div class="file-icon">{getFileIcon(props.item)}</div>
      <div class="file-name">{props.item.name}</div>

      {props.viewStyle === "list" && (
        <>
          <div class="file-size">
            {props.item.isFile ? formatFileSize(props.item.size) : "—"}
          </div>
          <div class="file-modified">{formatDate(props.item.modified)}</div>
        </>
      )}

      {props.viewStyle === "grid" && (
        <div class="file-meta">
          {props.item.isFile ? formatFileSize(props.item.size) : "Folder"}
        </div>
      )}

      <div class="file-item-actions">
        <button
          class="eden-btn eden-btn-danger eden-btn-xs file-action-btn"
          onClick={(e) => props.onDelete(props.item, e)}
          title="Delete"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default FileItemComponent;

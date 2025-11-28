import type { Component } from "solid-js";
import type { FileItem } from "../types";
import { getFileIcon, formatFileSize } from "../utils";

interface FileItemComponentProps {
  item: FileItem;
  isSelected: boolean;
  onClick: (item: FileItem) => void;
  onDoubleClick: (item: FileItem) => void;
  onDelete: (item: FileItem, e: MouseEvent) => void;
}

const FileItemComponent: Component<FileItemComponentProps> = (props) => {
  return (
    <div
      class="file-item"
      classList={{ selected: props.isSelected }}
      onClick={() => props.onClick(props.item)}
      onDblClick={() => props.onDoubleClick(props.item)}
    >
      <div class="file-icon">{getFileIcon(props.item)}</div>
      <div class="file-name">{props.item.name}</div>
      <div class="file-meta">
        {props.item.isFile ? formatFileSize(props.item.size) : "Folder"}
      </div>
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

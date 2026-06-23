import type { Component } from "solid-js";
import type {
  FileExplorerLabels,
  FileItem,
  ItemSize,
  ViewStyle,
} from "../types";
import { formatFileSize, getFileIcon } from "../utils";

interface FileItemComponentProps {
  ref?: (el: HTMLDivElement) => void;
  labels: FileExplorerLabels;
  item: FileItem;
  isSelected: boolean;
  viewStyle: ViewStyle;
  itemSize: ItemSize;
  onClick: (item: FileItem, event: MouseEvent) => void;
  onContextMenu?: (item: FileItem, e: MouseEvent) => void;
  onDelete?: (item: FileItem, e: MouseEvent) => void;
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
    >
      <button
        type="button"
        class="file-item-main"
        onClick={(event) => props.onClick(props.item, event)}
        onContextMenu={(e) => props.onContextMenu?.(props.item, e)}
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
            {props.item.isFile
              ? formatFileSize(props.item.size)
              : props.labels.folder}
          </div>
        )}
      </button>

      {props.onDelete && (
        <div class="file-item-actions">
          <button
            type="button"
            class="eden-btn eden-btn-danger eden-btn-xs file-action-btn"
            onClick={(e) => props.onDelete?.(props.item, e)}
            title={props.labels.delete}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export { FileItemComponent };
export default FileItemComponent;

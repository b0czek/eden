import { type Component, type JSX, Show } from "solid-js";
import type {
  FileExplorerLabels,
  FileItem,
  ItemSize,
  ViewStyle,
} from "../types";
import { formatFileSize, getFileIcon } from "../utils";
import FileGraphic from "./FileGraphic";

export interface FileItemComponentProps {
  ref?: (el: HTMLDivElement) => void;
  labels: FileExplorerLabels;
  item: FileItem;
  displayName?: string;
  icon?: JSX.Element;
  metadata?: JSX.Element;
  selectionDisabled?: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  selectionMode?: boolean;
  disabled?: boolean;
  viewStyle: ViewStyle;
  itemSize: ItemSize;
  onClick: (
    item: FileItem,
    event: MouseEvent,
    pointerType: string | undefined,
  ) => void;
  onDoubleClick: (item: FileItem) => void;
  onContextMenu?: (item: FileItem, e: MouseEvent) => void;
  onDelete?: (item: FileItem, e: MouseEvent) => void;
  onSelectionToggle?: (
    item: FileItem,
    event?: MouseEvent | KeyboardEvent,
  ) => void;
}

const FileItemComponent: Component<FileItemComponentProps> = (props) => {
  let pointerType: string | undefined;

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
      data-file-volume={props.item.location.volume}
      data-file-path={props.item.location.path}
      class="file-item"
      classList={{
        selected: props.isSelected,
        focused: props.isFocused,
        "selection-mode": props.selectionMode,
        disabled: props.disabled,
        "list-view": props.viewStyle === "list",
        [`size-${props.itemSize}`]: true,
      }}
    >
      <button
        type="button"
        class="file-item-main"
        disabled={props.disabled}
        aria-pressed={props.selectionMode ? props.isSelected : undefined}
        onPointerDown={(event) => {
          pointerType = event.pointerType;
        }}
        onClick={(event) => props.onClick(props.item, event, pointerType)}
        onDblClick={() => props.onDoubleClick(props.item)}
        onContextMenu={(e) => props.onContextMenu?.(props.item, e)}
      >
        <div class="file-icon">
          <Show
            when={props.icon}
            fallback={<FileGraphic src={getFileIcon(props.item)} />}
          >
            {props.icon}
          </Show>
        </div>
        <div class="file-name">{props.displayName ?? props.item.name}</div>

        <Show
          when={props.metadata}
          fallback={
            <>
              {props.viewStyle === "list" && (
                <>
                  <div class="file-size">
                    {props.item.isFile ? formatFileSize(props.item.size) : "—"}
                  </div>
                  <div class="file-modified">
                    {formatDate(props.item.modified)}
                  </div>
                </>
              )}

              {props.viewStyle === "grid" && (
                <div class="file-meta">
                  {props.item.isFile
                    ? formatFileSize(props.item.size)
                    : props.labels.folder}
                </div>
              )}
            </>
          }
        >
          {props.metadata}
        </Show>
      </button>

      {props.selectionMode && (
        <input
          type="checkbox"
          class="eden-checkbox file-selection-checkbox"
          checked={props.isSelected}
          disabled={props.disabled || props.selectionDisabled}
          aria-label={`${props.labels.selectItem ?? "Select"} ${props.displayName ?? props.item.name}`}
          onClick={(event) => {
            event.stopPropagation();
            props.onSelectionToggle?.(props.item, event);
          }}
        />
      )}

      {props.onDelete && !props.selectionMode && (
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

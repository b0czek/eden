export type ContextMenuCloseReason =
  | "select"
  | "dismiss"
  | "replaced"
  | "close";

export interface ContextMenuPosition {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/**
 * Available icon names for context menu items.
 */
export type ContextMenuIconName =
  // Actions
  | "plus"
  | "minus"
  | "x"
  | "check"
  | "check-circle"
  | "x-circle"
  | "refresh-cw"
  | "refresh-ccw"
  | "rotate-cw"
  | "rotate-ccw"
  // Edit
  | "edit"
  | "edit-2"
  | "edit-3"
  | "scissors"
  | "copy"
  | "clipboard"
  // Files
  | "file"
  | "file-text"
  | "file-plus"
  | "file-minus"
  | "folder"
  | "folder-plus"
  | "folder-minus"
  | "save"
  | "download"
  | "upload"
  // Trash
  | "trash"
  | "trash-2"
  // Navigation
  | "arrow-up"
  | "arrow-down"
  | "arrow-left"
  | "arrow-right"
  | "chevron-up"
  | "chevron-down"
  | "chevron-left"
  | "chevron-right"
  | "corner-up-left"
  | "corner-up-right"
  | "move"
  | "maximize"
  | "minimize"
  | "maximize-2"
  | "minimize-2"
  // View
  | "eye"
  | "eye-off"
  | "zoom-in"
  | "zoom-out"
  | "search"
  | "filter"
  | "list"
  | "grid"
  | "layout"
  | "sidebar"
  | "columns"
  // Media
  | "play"
  | "pause"
  | "stop-circle"
  | "skip-back"
  | "skip-forward"
  | "volume"
  | "volume-1"
  | "volume-2"
  | "volume-x"
  | "image"
  | "camera"
  | "film"
  | "music"
  // Communication
  | "mail"
  | "message-square"
  | "message-circle"
  | "send"
  | "share"
  | "share-2"
  | "phone"
  // Users
  | "user"
  | "user-plus"
  | "user-minus"
  | "user-x"
  | "user-check"
  | "users"
  // Settings
  | "settings"
  | "sliders"
  | "tool"
  | "wrench"
  | "terminal"
  | "code"
  // Status
  | "info"
  | "alert-circle"
  | "alert-triangle"
  | "help-circle"
  | "bell"
  | "bell-off"
  // Misc
  | "star"
  | "heart"
  | "bookmark"
  | "flag"
  | "tag"
  | "clock"
  | "calendar"
  | "lock"
  | "unlock"
  | "key"
  | "shield"
  | "link"
  | "link-2"
  | "external-link"
  | "log-in"
  | "log-out"
  | "power"
  | "more-horizontal"
  | "more-vertical"
  | "menu"
  | "home"
  | "globe"
  | "package"
  | "printer"
  | "archive"
  | "box"
  | "hash"
  | "at-sign"
  | "percent"
  | "type"
  | "bold"
  | "italic"
  | "underline"
  | "align-left"
  | "align-center"
  | "align-right";

export type ContextMenuItem =
  | {
      type: "item";
      id: string;
      label: string;
      icon?: ContextMenuIconName;
      shortcut?: string;
      disabled?: boolean;
      danger?: boolean;
    }
  | { type: "separator" }
  | { type: "title"; label: string };

export interface ContextMenuOpenArgs {
  title?: string;
  position: ContextMenuPosition;
  items: ContextMenuItem[];
}

export interface ContextMenuOpenEvent extends ContextMenuOpenArgs {
  requestId: string;
}

export interface ContextMenuResult {
  requestId: string;
  itemId?: string;
  reason: ContextMenuCloseReason;
}

import type { ViewBounds } from "./index";

export type FilePickerMode = "open" | "save";

export type FilePickerSelectionMode = "file" | "directory";

export type FilePickerCloseReason = "select" | "cancel" | "close";

export interface FilePickerFilter {
  name: string;
  extensions?: string[];
  mimeTypes?: string[];
}

export interface FilePickerOpenArgs {
  mode: FilePickerMode;
  selection?: FilePickerSelectionMode;
  multiple?: boolean;
  title?: string;
  initialPath?: string;
  suggestedName?: string;
  filters?: FilePickerFilter[];
  confirmLabel?: string;
  canCreateDirectories?: boolean;
  overwritePrompt?: boolean;
}

export interface FilePickerOpenEvent extends FilePickerOpenArgs {
  requestId: string;
  opener: {
    appId: string;
    viewId?: number;
    bounds?: ViewBounds;
  };
}

export interface FilePickerResult {
  requestId: string;
  reason: FilePickerCloseReason;
  path?: string;
  paths?: string[];
}

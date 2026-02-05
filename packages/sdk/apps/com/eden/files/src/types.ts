export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  modified: Date;
}

export type ViewStyle = "grid" | "list";
export type ItemSize = "tiny" | "small" | "medium" | "large" | "huge";
export type SortBy = "name" | "size" | "modified";
export type SortOrder = "asc" | "desc";

export interface DisplayPreferences {
  viewStyle: ViewStyle;
  itemSize: ItemSize;
  sortBy: SortBy;
  sortOrder: SortOrder;
}

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

export interface Breadcrumb {
  name: string;
  path: string;
}

export interface FileExplorerLabels {
  goBack: string;
  goForward: string;
  goUp: string;
  newFolder: string;
  newFile: string;
  settings: string;
  editPath: string;
  searchPlaceholder: string;
  loading: string;
  empty: string;
  emptyHint: string;
  folder: string;
  delete: string;
  close: string;
  displayOptions: string;
  viewStyle: string;
  grid: string;
  list: string;
  displaySize: string;
  tiny: string;
  small: string;
  medium: string;
  large: string;
  huge: string;
  sortBy: string;
  name: string;
  size: string;
  modified: string;
  ascending: string;
  descending: string;
}

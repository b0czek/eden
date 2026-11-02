/** A virtual path within one Eden volume. */
export interface FilesystemLocation {
  volume: string;
  path: string;
}

/** Access mode selected when opening a file. */
export type FilesystemOpenMode = "read";

/** Runtime-owned open file. The identifier conveys no authority by itself. */
export interface FilesystemHandle {
  handleId: string;
}

/** One-shot access by location, or repeated access to an opened file. */
export type FilesystemSource = FilesystemLocation | FilesystemHandle;

export type FilesystemVolumeKind = "local" | "removable" | "network";
export type FilesystemVolumeState = "ready" | "ejecting";

/** Public volume metadata. Host mount paths are never sent to apps. */
export interface FilesystemVolume {
  id: string;
  label: string;
  kind: FilesystemVolumeKind;
  readOnly: boolean;
  supportsWatch: boolean;
  supportsEject: boolean;
  /** Deleted items can move to Trash instead of being removed permanently. */
  supportsTrash: boolean;
  state: FilesystemVolumeState;
}

/** Main-process registration of an already mounted directory. */
export interface FilesystemVolumeRegistration {
  id: string;
  label: string;
  kind: FilesystemVolumeKind;
  rootPath: string;
  readOnly?: boolean;
  supportsWatch?: boolean;
}

/** A Home item held in Trash, visible to callers that can access its original folder. */
export interface TrashEntry {
  id: string;
  name: string;
  original: FilesystemLocation;
  /** ISO 8601 time when the item was moved to Trash. */
  deletedAt: string;
  isDirectory: boolean;
  isFile: boolean;
  size: number;
}

/** An occupied destination keeps both the existing item and the Trash entry. */
export type TrashRestoreResult =
  | { status: "restored"; location: FilesystemLocation }
  | { status: "occupied" };

export interface FilesystemTransferArgs {
  from: FilesystemLocation;
  to: FilesystemLocation;
  /** Replace the complete destination when it already exists. */
  overwrite?: boolean;
}

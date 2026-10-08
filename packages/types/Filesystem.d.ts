/** A virtual path within one Eden volume. */
export interface FilesystemLocation {
  volume: string;
  path: string;
}

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

export interface FilesystemTransferArgs {
  from: FilesystemLocation;
  to: FilesystemLocation;
  /** Replace the complete destination when it already exists. */
  overwrite?: boolean;
}

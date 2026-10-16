import type {
  AppAssociation,
  FilesystemLocation,
  FilesystemVolume,
  RuntimeAppManifest,
  ViewBounds,
} from "@edenapp/types";
import type * as Effect from "effect/Effect";
import type { Event } from "../events/event";

export interface FilePickerCaller {
  appId?: string;
  webContentsId?: number;
}

export interface FilePickerAssociations {
  resolve(
    key: string,
    matches: (app: RuntimeAppManifest) => boolean,
  ): AppAssociation[];
}

export interface FilePickerViews {
  resolve(webContentsId?: number): number | undefined;
  get(viewId: number): { alive: boolean; bounds?: ViewBounds } | undefined;
  reveal(viewId: number): Effect.Effect<void, Error>;
}

export interface FilePickerProcesses {
  ensureRunning(appId: string): Effect.Effect<void, Error>;
  isRunning(appId: string): boolean;
  stop(appId: string): Effect.Effect<void, Error>;
  stopped: Pick<Event<{ appId: string }>, "on">;
}

export interface FilePickerFiles {
  resolvePath(location: FilesystemLocation): Effect.Effect<void, Error>;
  accessScope(volume: string): FilesystemLocation;
}

export interface FilePickerVolumes {
  get(id: string): Pick<FilesystemVolume, "state" | "readOnly">;
}

export interface FilePickerPermissions {
  hasPermission(appId: string, permission: string): boolean;
}

export interface FilePickerNotifications {
  busy(replace: Effect.Effect<{ requestId: string }, Error>): void;
}

export interface FilePickerDependencies {
  associations: FilePickerAssociations;
  views: FilePickerViews;
  processes: FilePickerProcesses;
  files: FilePickerFiles;
  volumes: FilePickerVolumes;
  permissions: FilePickerPermissions;
  notifications: FilePickerNotifications;
}

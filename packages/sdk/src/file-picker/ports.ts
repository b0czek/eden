import type { FilesystemLocation, ViewBounds } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { Event } from "../events/event";
import type { FilePickerIoFailed, FilePickerOpenError } from "./errors";

export interface FilePickerViews {
  resolve(webContentsId?: number): number | undefined;
  get(viewId: number): { alive: boolean; bounds?: ViewBounds } | undefined;
  reveal(viewId: number): Effect.Effect<void, FilePickerIoFailed>;
}
export const FilePickerViews = Context.Service<
  "eden/FilePickerViews",
  FilePickerViews
>("eden/FilePickerViews");

export interface FilePickerProcesses {
  ensureRunning(appId: string): Effect.Effect<void, FilePickerIoFailed>;
  isRunning(appId: string): boolean;
  stop(appId: string): Effect.Effect<void, FilePickerIoFailed>;
  stopped: Pick<Event<{ appId: string }>, "on">;
}
export const FilePickerProcesses = Context.Service<
  "eden/FilePickerProcesses",
  FilePickerProcesses
>("eden/FilePickerProcesses");

export interface FilePickerFiles {
  resolvePath(
    location: FilesystemLocation,
  ): Effect.Effect<void, FilePickerIoFailed>;
  /** Synchronously throws FilesystemAccessDenied or VolumeUnavailable on access refusal. */
  accessScope(volume: string): FilesystemLocation;
}
export const FilePickerFiles = Context.Service<
  "eden/FilePickerFiles",
  FilePickerFiles
>("eden/FilePickerFiles");

export interface FilePickerNotifications {
  busy(
    replace: Effect.Effect<{ requestId: string }, FilePickerOpenError>,
  ): Effect.Effect<void, FilePickerIoFailed>;
}
export const FilePickerNotifications = Context.Service<
  "eden/FilePickerNotifications",
  FilePickerNotifications
>("eden/FilePickerNotifications");

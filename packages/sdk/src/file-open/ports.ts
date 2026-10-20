import type { FilesystemLocation } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { ProcessLaunchError } from "../processes/errors";
import type { FileInspectionError } from "./errors";

/** Metadata and content inspection under a filesystem volume lease. */
export interface FileOpenFilesystem {
  inspect(location: FilesystemLocation): Effect.Effect<
    {
      isDirectory: boolean;
      mimeType?: string;
    },
    FileInspectionError
  >;
  isDirectory(
    location: FilesystemLocation,
  ): Effect.Effect<boolean, FileInspectionError>;
}
export const FileOpenFilesystem = Context.Service<
  "eden/FileOpenFilesystem",
  FileOpenFilesystem
>("eden/FileOpenFilesystem");

/** Adapts file delivery to the process launch protocol. */
export interface FileOpenProcesses {
  isRunning(appId: string): boolean;
  launch(
    appId: string,
    location: FilesystemLocation,
  ): Effect.Effect<void, ProcessLaunchError>;
}
export const FileOpenProcesses = Context.Service<
  "eden/FileOpenProcesses",
  FileOpenProcesses
>("eden/FileOpenProcesses");

import type { FilesystemLocation } from "@edenapp/types";
import * as Data from "effect/Data";
import type { ProcessLaunchError } from "../../applications/processes/errors";
import type { FilesystemPathError } from "../../platform/filesystem/errors";
import type { FilesystemIoFailed } from "../../platform/filesystem/native-errors";
import type { StorageReadFailure } from "../../platform/storage/errors";
import type { ViewMutationError } from "../views/errors";

export class FileHandlerUnavailable extends Data.TaggedError(
  "FileHandlerUnavailable",
)<{
  location: FilesystemLocation;
  appId?: string;
  reason: "no-handler" | "not-installed";
  message: string;
}> {}

export class FileTypeUnknown extends Data.TaggedError("FileTypeUnknown")<{
  location: FilesystemLocation;
  message: string;
}> {}

export type FileInspectionError = FilesystemPathError;
export type FileOpenError =
  | FileInspectionError
  | FileHandlerUnavailable
  | ProcessLaunchError
  | ViewMutationError;

export type FilePreferenceWriteError = FileInspectionError | FilesystemIoFailed;
export type FilePreferenceSetError = FilePreferenceWriteError | FileTypeUnknown;
export type FileHandlerQueryError = FileInspectionError | StorageReadFailure;

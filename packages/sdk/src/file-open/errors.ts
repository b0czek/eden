import type { FilesystemLocation } from "@edenapp/types";
import * as Data from "effect/Data";
import type { AppAssociationStorageWriteError } from "../app-associations/errors";
import type { FilesystemPathError } from "../filesystem/errors";
import type { ProcessLaunchError } from "../processes/errors";
import type { StorageReadFailure } from "../storage/errors";
import type { ViewMutationError } from "../views/errors";

export class FileMetadataFailed extends Data.TaggedError("FileMetadataFailed")<{
  location: FilesystemLocation;
  message: string;
  cause: unknown;
}> {}

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

export type FileInspectionError = FilesystemPathError | FileMetadataFailed;
export type FileOpenError =
  | FileInspectionError
  | FileHandlerUnavailable
  | ProcessLaunchError
  | ViewMutationError;

export type FilePreferenceWriteError =
  | FileInspectionError
  | AppAssociationStorageWriteError;
export type FilePreferenceSetError = FilePreferenceWriteError | FileTypeUnknown;
export type FileHandlerQueryError = FileInspectionError | StorageReadFailure;

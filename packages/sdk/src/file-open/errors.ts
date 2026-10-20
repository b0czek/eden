import type { FilesystemLocation } from "@edenapp/types";
import * as Data from "effect/Data";
import type { FilesystemPathError } from "../filesystem/errors";
import type { ProcessLaunchError } from "../processes/errors";

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
  | ProcessLaunchError;

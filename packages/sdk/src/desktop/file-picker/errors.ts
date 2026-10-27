import type { FilesystemLocation } from "@edenapp/types";
import * as Data from "effect/Data";
import type { FilesystemPathError } from "../../platform/filesystem/errors";
import type { VolumeUnavailable } from "../../platform/filesystem/volumes/errors";

export class FilePickerRequestRejected extends Data.TaggedError(
  "FilePickerRequestRejected",
)<{
  operation: "open" | "resolve" | "close";
  reason:
    | "disposed"
    | "invalid-volumes"
    | "invalid-location"
    | "volume-not-allowed"
    | "missing-caller"
    | "missing-view"
    | "provider-caller"
    | "busy"
    | "unauthorized"
    | "invalid-selection"
    | "volume-removing"
    | "volume-read-only";
  requestId?: string;
  message: string;
}> {}

export class FilePickerProviderRejected extends Data.TaggedError(
  "FilePickerProviderRejected",
)<{
  appId?: string;
  expectedAppId?: string;
  message: string;
}> {}

export class FilePickerProviderUnavailable extends Data.TaggedError(
  "FilePickerProviderUnavailable",
)<{
  reason: "missing" | "ambiguous" | "timeout" | "disposed" | "unregistered";
  appIds?: string[];
  message: string;
}> {}

export class FilePickerIoFailed extends Data.TaggedError("FilePickerIoFailed")<{
  operation: "reveal-provider" | "start-provider" | "notify-busy";
  appId?: string;
  viewId?: number;
  location?: FilesystemLocation;
  message: string;
  cause: unknown;
}> {}

export type FilePickerOpenError =
  | FilePickerRequestRejected
  | FilePickerProviderUnavailable
  | FilePickerIoFailed
  | FilesystemPathError;
export type FilePickerResolveError =
  | FilePickerRequestRejected
  | VolumeUnavailable;

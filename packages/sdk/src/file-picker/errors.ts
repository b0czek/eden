import type { FilesystemLocation } from "@edenapp/types";
import * as Data from "effect/Data";
import { FilesystemAccessDenied } from "../filesystem/errors";
import { VolumeUnavailable } from "../filesystem/volumes/errors";

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
  operation:
    | "resolve-location"
    | "reveal-provider"
    | "start-provider"
    | "stop-provider"
    | "notify-busy";
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
  | FilesystemAccessDenied
  | VolumeUnavailable;
export type FilePickerResolveError =
  | FilePickerRequestRejected
  | VolumeUnavailable;

/** Only documented synchronous refusals become expected failures. */
export function requestRejection(cause: unknown): FilePickerRequestRejected {
  if (cause instanceof FilePickerRequestRejected) return cause;
  throw cause;
}

export function selectionRejection(cause: unknown): FilePickerResolveError {
  if (cause instanceof VolumeUnavailable) return cause;
  return requestRejection(cause);
}

export function openRejection(cause: unknown): FilePickerOpenError {
  if (
    cause instanceof FilePickerProviderUnavailable ||
    cause instanceof FilesystemAccessDenied
  )
    return cause;
  return selectionRejection(cause);
}

export function providerRejection(cause: unknown): FilePickerProviderRejected {
  if (cause instanceof FilePickerProviderRejected) return cause;
  throw cause;
}

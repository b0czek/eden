import * as Data from "effect/Data";
import { FilesystemIoFailed } from "./native-errors";
import { type VolumeAccessError, VolumeUnavailable } from "./volumes/errors";

export class FilesystemAccessDenied extends Data.TaggedError(
  "FilesystemAccessDenied",
)<{
  message: string;
  path?: string;
  cause?: unknown;
}> {}
export class FilesystemHandleRejected extends Data.TaggedError(
  "FilesystemHandleRejected",
)<{
  message: string;
  handleId?: string;
}> {}
export class FilesystemWatchRejected extends Data.TaggedError(
  "FilesystemWatchRejected",
)<{
  message: string;
  watchId?: string;
}> {}
export class FilesystemTransferRejected extends Data.TaggedError(
  "FilesystemTransferRejected",
)<{
  message: string;
  source: string;
  destination: string;
}> {}
export class FilesystemTransferIncomplete extends Data.TaggedError(
  "FilesystemTransferIncomplete",
)<{
  message: string;
  source: string;
  destination: string;
  cause: unknown;
}> {}
export type FilesystemPathError =
  | FilesystemAccessDenied
  | VolumeAccessError
  | FilesystemIoFailed;
export type FilesystemFileError =
  | FilesystemPathError
  | FilesystemHandleRejected;
export type FilesystemTransferError =
  | FilesystemPathError
  | FilesystemTransferRejected
  | FilesystemTransferIncomplete;
export type FilesystemWatchError =
  | FilesystemPathError
  | FilesystemWatchRejected;

/** Only documented synchronous refusals become expected failures. */
export function accessRejection(
  cause: unknown,
): FilesystemAccessDenied | VolumeUnavailable {
  if (
    cause instanceof FilesystemAccessDenied ||
    cause instanceof VolumeUnavailable
  )
    return cause;
  throw cause;
}
export function handleRejection(cause: unknown): FilesystemHandleRejected {
  if (cause instanceof FilesystemHandleRejected) return cause;
  throw cause;
}
export function watchRejection(
  cause: unknown,
): FilesystemWatchRejected | FilesystemIoFailed | VolumeUnavailable {
  if (
    cause instanceof FilesystemWatchRejected ||
    cause instanceof FilesystemIoFailed ||
    cause instanceof VolumeUnavailable
  )
    return cause;
  throw cause;
}

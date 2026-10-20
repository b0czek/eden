import * as Data from "effect/Data";

/** A synchronous volume admission or lifecycle refusal. */
export class VolumeUnavailable extends Data.TaggedError("VolumeUnavailable")<{
  volume: string;
  message: string;
}> {}
export class VolumeRegistrationRejected extends Data.TaggedError(
  "VolumeRegistrationRejected",
)<{
  volume: string;
  message: string;
}> {}
export class VolumeEjectRejected extends Data.TaggedError(
  "VolumeEjectRejected",
)<{
  volume: string;
  message: string;
}> {}
export class VolumeIoFailed extends Data.TaggedError("VolumeIoFailed")<{
  volume: string;
  operation: "register" | "inspect" | "eject";
  path?: string;
  message: string;
  cause: unknown;
}> {
  get code(): string | undefined {
    return (this.cause as NodeJS.ErrnoException | undefined)?.code;
  }
}
export type VolumeAccessError = VolumeUnavailable | VolumeIoFailed;
export type VolumeRegistrationError =
  | VolumeRegistrationRejected
  | VolumeIoFailed;
export type VolumeEjectError = VolumeAccessError | VolumeEjectRejected;

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
export class FilesystemIoFailed extends Data.TaggedError("FilesystemIoFailed")<{
  operation: string;
  path?: string;
  descriptor?: number;
  message: string;
  cause: unknown;
}> {
  /** Native errno is retained for existing absence/cross-device recovery. */
  get code(): string | undefined {
    return (this.cause as NodeJS.ErrnoException | undefined)?.code;
  }
}
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
export function volumeRejection(cause: unknown): VolumeUnavailable {
  if (cause instanceof VolumeUnavailable) return cause;
  throw cause;
}
export function volumeRegistrationRejection(
  cause: unknown,
): VolumeRegistrationRejected {
  if (cause instanceof VolumeRegistrationRejected) return cause;
  throw cause;
}

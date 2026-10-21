import * as Data from "effect/Data";

/** Volume API admission requires an authenticated caller or trusted host. */
export class VolumeAccessDenied extends Data.TaggedError("VolumeAccessDenied")<{
  message: string;
}> {}

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

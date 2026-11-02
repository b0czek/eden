import * as Data from "effect/Data";

export class StreamOwnerUnavailable extends Data.TaggedError(
  "StreamOwnerUnavailable",
)<{ command: string }> {
  override get message() {
    return `Stream command '${this.command}' requires an app view or backend caller`;
  }
}
export class StreamCapacityExhausted extends Data.TaggedError(
  "StreamCapacityExhausted",
)<{ command: string; capacity: number }> {
  override get message() {
    return `Stream capacity exhausted for this caller; cancel a stream before opening '${this.command}'`;
  }
}
export class StreamAdmissionClosed extends Data.TaggedError(
  "StreamAdmissionClosed",
)<{ command: string }> {
  override readonly message = "Eden is shutting down; new streams are closed";
}

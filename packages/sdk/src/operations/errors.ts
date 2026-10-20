import type { OperationHandle } from "@edenapp/types";
import * as Data from "effect/Data";

export class InvalidOperationRequestKey extends Data.TaggedError(
  "InvalidOperationRequestKey",
)<{ requestKey: unknown }> {
  override readonly message = "Invalid operation request key";
}
export class OperationRequestConflict extends Data.TaggedError(
  "OperationRequestConflict",
)<{ command: string; requestKey: string }> {
  override readonly message =
    "Operation request key reused with different command or arguments";
}
export class OperationAdmissionClosed extends Data.TaggedError(
  "OperationAdmissionClosed",
)<{ sessionId: string }> {
  override readonly message =
    "Operations are draining; new submissions are closed";
}
export class OperationCapacityExhausted extends Data.TaggedError(
  "OperationCapacityExhausted",
)<{ appId?: string; capacity: "caller" | "shared" }> {
  override get message() {
    return this.capacity === "caller"
      ? "Operation capacity exhausted for this caller; retry after records expire"
      : "Shared operation capacity exhausted; retry after records expire";
  }
}
export class SessionTransitionInProgress extends Data.TaggedError(
  "SessionTransitionInProgress",
)<{ sessionId: string }> {
  override readonly message = "A session transition is already in progress";
}
export class OperationNotFound extends Data.TaggedError("OperationNotFound")<{
  handle: OperationHandle;
}> {
  override readonly message = "Operation not found or access denied";
}
export class OperationNotCancellable extends Data.TaggedError(
  "OperationNotCancellable",
)<{ handle: OperationHandle }> {
  override readonly message = "Operation cannot be cancelled";
}
export class OperationCancelled extends Data.TaggedError("OperationCancelled")<{
  handle: OperationHandle;
}> {
  override readonly name = "AbortError";
  override readonly message = "Operation cancelled";
}

export type OperationAdmissionFailure =
  | InvalidOperationRequestKey
  | OperationRequestConflict
  | OperationAdmissionClosed
  | OperationCapacityExhausted
  | SessionTransitionInProgress;

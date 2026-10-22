import * as Data from "effect/Data";
import { asError } from "../../core/effects/io";

export type StorageOperation =
  | "read"
  | "readMany"
  | "write"
  | "remove"
  | "keys";

export class StorageOpenError extends Data.TaggedError("StorageOpenError")<{
  readonly resource: string;
  readonly cause: unknown;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export class StorageClosedError extends Data.TaggedError("StorageClosedError")<{
  readonly resource: string;
  readonly operation: StorageOperation;
  readonly keys: readonly string[];
  readonly message: string;
}> {}

export class StorageReadError extends Data.TaggedError("StorageReadError")<{
  readonly resource: string;
  readonly operation: "read" | "readMany";
  readonly keys: readonly string[];
  readonly cause: unknown;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export class StorageWriteError extends Data.TaggedError("StorageWriteError")<{
  readonly resource: string;
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export class StorageRemoveError extends Data.TaggedError("StorageRemoveError")<{
  readonly resource: string;
  readonly key: string;
  readonly cause: unknown;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export class StorageDisconnectError extends Data.TaggedError(
  "StorageDisconnectError",
)<{
  readonly resource: string;
  readonly cause: unknown;
}> {
  override get message() {
    return asError(this.cause).message;
  }
}

export type StorageReadFailure = StorageReadError | StorageClosedError;
export type StorageWriteFailure = StorageWriteError | StorageClosedError;
export type StorageRemoveFailure = StorageRemoveError | StorageClosedError;
export type StorageFailure =
  | StorageReadFailure
  | StorageWriteFailure
  | StorageRemoveFailure;

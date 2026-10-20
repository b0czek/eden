import * as Data from "effect/Data";
import { asError } from "../effects/io";

export class AppAssociationStorageReadError extends Data.TaggedError(
  "AppAssociationStorageReadError",
)<{
  readonly path: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return asError(this.cause).message;
  }
}

export class AppAssociationStorageWriteError extends Data.TaggedError(
  "AppAssociationStorageWriteError",
)<{
  readonly path: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return asError(this.cause).message;
  }
}

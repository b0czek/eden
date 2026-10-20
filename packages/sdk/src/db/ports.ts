import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type {
  StorageClosedError,
  StorageReadFailure,
  StorageRemoveFailure,
  StorageWriteFailure,
} from "../storage/errors";

export interface DbStorage {
  read(key: string): Effect.Effect<unknown, StorageReadFailure>;
  write(key: string, value: string): Effect.Effect<void, StorageWriteFailure>;
  remove(key: string): Effect.Effect<boolean, StorageRemoveFailure>;
  /** Returns keys collected before an unsupported or failed iteration. */
  keys(): Effect.Effect<readonly unknown[], StorageClosedError>;
}
export const DbStorage = Context.Service<"eden/DbStorage", DbStorage>(
  "eden/DbStorage",
);

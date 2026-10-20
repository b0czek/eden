import KeyvSqlite from "@keyv/sqlite";
import * as Effect from "effect/Effect";
import Keyv from "keyv";
import { fromPromise } from "../effects/io";
import { log } from "../logging";
import {
  StorageClosedError,
  StorageDisconnectError,
  StorageOpenError,
  type StorageOperation,
  StorageReadError,
  type StorageReadFailure,
  StorageRemoveError,
  type StorageRemoveFailure,
  StorageWriteError,
  type StorageWriteFailure,
} from "./errors";

export interface SqliteStorage {
  read(key: string): Effect.Effect<unknown, StorageReadFailure>;
  readMany(keys: string[]): Effect.Effect<unknown[], StorageReadFailure>;
  write(key: string, value: unknown): Effect.Effect<void, StorageWriteFailure>;
  remove(key: string): Effect.Effect<boolean, StorageRemoveFailure>;
  keys(): Effect.Effect<unknown[], StorageClosedError>;
}

export const openKeyvSqlite = Effect.fn(function* ({
  dbPath,
  label,
  closedMessage,
}: {
  dbPath: string;
  label: string;
  closedMessage: string;
}) {
  let closed = false;
  const disconnect = (keyv: Keyv) =>
    fromPromise(
      () => keyv.disconnect(),
      (cause) => new StorageDisconnectError({ resource: dbPath, cause }),
    );

  const keyv = yield* Effect.acquireRelease(
    Effect.gen(function* () {
      const { keyv, store } = yield* Effect.try({
        try: () => {
          const store = new KeyvSqlite(`sqlite://${dbPath}`);
          const keyv = new Keyv({ store, throwOnErrors: true });
          keyv.on("error", (error) => log.error("Database error:", error));
          return { keyv, store };
        },
        catch: (cause) => new StorageOpenError({ resource: dbPath, cause }),
      });
      // Construction starts connecting; wait for initial table creation before
      // publishing a usable capability.
      yield* fromPromise(
        () => store.query("SELECT 1"),
        (cause) => new StorageOpenError({ resource: dbPath, cause }),
      ).pipe(
        Effect.onError(() =>
          disconnect(keyv).pipe(
            Effect.catch((error) =>
              Effect.sync(() => log.warn("Database cleanup failed:", error)),
            ),
          ),
        ),
      );
      log.info(`Initialized ${label} at ${dbPath}`);
      return keyv;
    }),
    (keyv) =>
      Effect.gen(function* () {
        closed = true;
        yield* disconnect(keyv).pipe(Effect.orDie);
      }),
  );

  function perform<A, E>(
    operation: StorageOperation,
    keys: readonly string[],
    task: () => Promise<A>,
    onError: (cause: unknown) => E,
  ) {
    // SQLite cannot abort accepted I/O; settle it before releasing the connection.
    return Effect.uninterruptible(
      Effect.suspend<A, E | StorageClosedError, never>(() =>
        closed
          ? Effect.fail(
              new StorageClosedError({
                resource: dbPath,
                operation,
                keys,
                message: closedMessage,
              }),
            )
          : fromPromise(task, onError),
      ),
    );
  }

  const storage: SqliteStorage = {
    read: (key) =>
      perform(
        "read",
        [key],
        () => keyv.get(key),
        (cause) =>
          new StorageReadError({
            resource: dbPath,
            operation: "read",
            keys: [key],
            cause,
          }),
      ),
    readMany: (keys) =>
      perform(
        "readMany",
        keys,
        () => keyv.getMany(keys),
        (cause) =>
          new StorageReadError({
            resource: dbPath,
            operation: "readMany",
            keys: [...keys],
            cause,
          }),
      ),
    write: (key, value) =>
      perform(
        "write",
        [key],
        () => keyv.set(key, value),
        (cause) => new StorageWriteError({ resource: dbPath, key, cause }),
      ).pipe(Effect.asVoid),
    remove: (key) =>
      perform(
        "remove",
        [key],
        () => keyv.delete(key),
        (cause) => new StorageRemoveError({ resource: dbPath, key, cause }),
      ),
    keys: () =>
      perform(
        "keys",
        [],
        async () => {
          const keys: unknown[] = [];
          try {
            if (keyv.iterator) {
              for await (const [key] of keyv.iterator(undefined))
                keys.push(key);
            }
          } catch (error) {
            // Listing intentionally returns the keys collected before iteration failed.
            log.warn("Iterator not supported or failed:", error);
          }
          return keys;
        },
        (cause): never => {
          throw cause;
        },
      ),
  };
  return storage;
});

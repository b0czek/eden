import KeyvSqlite from "@keyv/sqlite";
import * as Effect from "effect/Effect";
import Keyv from "keyv";
import { asError } from "../effects/io";
import { log } from "../logging";

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
  const keyv = yield* Effect.acquireRelease(
    Effect.sync(() => {
      const keyv = new Keyv({ store: new KeyvSqlite(`sqlite://${dbPath}`) });
      keyv.on("error", (error) => log.error("Database error:", error));
      log.info(`Initialized ${label} at ${dbPath}`);
      return keyv;
    }),
    (keyv) =>
      Effect.tryPromise({
        try: () => {
          closed = true;
          return keyv.disconnect();
        },
        catch: asError,
      }).pipe(Effect.orDie),
  );

  function perform<A>(task: () => Promise<A>) {
    // SQLite cannot abort accepted I/O; settle it before releasing the connection.
    return Effect.uninterruptible(
      Effect.tryPromise({
        try: () => {
          if (closed) throw new Error(closedMessage);
          return task();
        },
        catch: asError,
      }),
    );
  }

  return {
    read: (key: string) => perform(() => keyv.get(key)),
    write: (key: string, value: unknown) =>
      perform(() => keyv.set(key, value)).pipe(Effect.asVoid),
    remove: (key: string) => perform(() => keyv.delete(key)),
    keys: () =>
      perform(async () => {
        const keys: unknown[] = [];
        try {
          if (keyv.iterator) {
            for await (const [key] of keyv.iterator(undefined)) keys.push(key);
          }
        } catch (error) {
          log.warn("Iterator not supported or failed:", error);
        }
        return keys;
      }),
  };
});

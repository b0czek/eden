import * as path from "node:path";
import KeyvSqlite from "@keyv/sqlite";
import * as Effect from "effect/Effect";
import Keyv from "keyv";
import { log } from "../logging";
import type { DbStorage } from "./ports";

export function createSqliteDbStorage({
  appsDirectory,
}: {
  appsDirectory: string;
}): DbStorage {
  const dbPath = path.join(appsDirectory, "storage.db");

  return {
    open: Effect.acquireRelease(
      Effect.sync(() => {
        const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
        const keyv = new Keyv({ store: sqlite });
        let closed = false;

        keyv.on("error", (error) => log.error("Database error:", error));
        log.info(`Initialized storage at ${dbPath}`);

        function perform<A>(task: () => Promise<A>) {
          // SQLite promises cannot be aborted. Managed runtime shutdown waits
          // for this I/O to settle before closing the connection's scope.
          return Effect.uninterruptible(
            Effect.tryPromise({
              try: () => {
                if (closed) throw new Error("Database connection closed");
                return task();
              },
              catch: (error) => error,
            }),
          );
        }

        return {
          read: (key: string) => perform(() => keyv.get(key)),
          write: (key: string, value: string) =>
            perform(async () => {
              await keyv.set(key, value);
            }),
          remove: (key: string) => perform(() => keyv.delete(key)),
          keys: () =>
            perform(async () => {
              const keys: unknown[] = [];
              try {
                if (keyv.iterator) {
                  for await (const [key] of keyv.iterator(undefined)) {
                    keys.push(key);
                  }
                }
              } catch (error) {
                log.warn("Iterator not supported or failed:", error);
              }
              return keys;
            }),
          close: Effect.tryPromise({
            try: async () => {
              closed = true;
              await keyv.disconnect();
            },
            catch: (error) => error,
          }),
        };
      }),
      (connection) => connection.close.pipe(Effect.orDie),
    ),
  };
}

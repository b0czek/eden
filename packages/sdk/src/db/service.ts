import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { DbStorage } from "./ports";

export function createDb(storage: DbStorage) {
  return Effect.gen(function* () {
    const connection = yield* storage.open;

    function get(appId: string, key: string) {
      return Effect.map(connection.read(`${appId}:${key}`), (value) => {
        if (value !== undefined && typeof value !== "string") {
          log.warn(
            `Non-string value found for key ${key}, converting to string`,
          );
          return String(value);
        }
        return value;
      });
    }

    function set(appId: string, key: string, value: string) {
      return Effect.suspend(() =>
        typeof value === "string"
          ? connection.write(`${appId}:${key}`, value)
          : Effect.fail(
              new Error(`Value must be a string, got ${typeof value}`),
            ),
      );
    }

    function remove(appId: string, key: string) {
      return connection.remove(`${appId}:${key}`);
    }

    function list(appId: string) {
      const prefix = `${appId}:`;
      return Effect.map(connection.keys(), (keys) =>
        keys
          .filter(
            (key): key is string =>
              typeof key === "string" && key.startsWith(prefix),
          )
          .map((key) => {
            const colon = key.indexOf(":");
            return colon > 0 ? key.substring(colon + 1) : key;
          }),
      );
    }

    function clear(appId: string) {
      return Effect.uninterruptible(
        Effect.gen(function* () {
          const keys = yield* list(appId);
          for (const key of keys) yield* remove(appId, key);
        }),
      );
    }

    function has(appId: string, key: string) {
      return Effect.map(
        connection.read(`${appId}:${key}`),
        (value) => value !== undefined,
      );
    }

    return { get, set, delete: remove, clear, list, has };
  });
}

export type Db = Effect.Success<ReturnType<typeof createDb>>;

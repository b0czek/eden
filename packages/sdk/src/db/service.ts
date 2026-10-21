import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { log } from "../logging/logger";
import type {
  StorageClosedError,
  StorageReadFailure,
  StorageRemoveFailure,
  StorageWriteFailure,
} from "../storage/errors";
import { DbInvalidValueError } from "./errors";
import { DbStorage } from "./ports";

export interface Db {
  get: (
    appId: string,
    key: string,
  ) => Effect.Effect<string | undefined, StorageReadFailure>;
  set: (
    appId: string,
    key: string,
    value: string,
  ) => Effect.Effect<void, StorageWriteFailure | DbInvalidValueError>;
  delete: (
    appId: string,
    key: string,
  ) => Effect.Effect<boolean, StorageRemoveFailure>;
  clear: (appId: string) => Effect.Effect<void, StorageRemoveFailure>;
  list: (appId: string) => Effect.Effect<string[], StorageClosedError>;
  has: (
    appId: string,
    key: string,
  ) => Effect.Effect<boolean, StorageReadFailure>;
}

export const Db = Context.Service<"eden/Db", Db>("eden/Db");

export const DbLive = Layer.effect(
  Db,
  Effect.gen(function* () {
    const connection = yield* DbStorage;

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
      return Effect.suspend<
        void,
        StorageWriteFailure | DbInvalidValueError,
        never
      >(() =>
        typeof value === "string"
          ? connection.write(`${appId}:${key}`, value)
          : Effect.fail(
              new DbInvalidValueError({ appId, key, valueType: typeof value }),
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
  }),
);

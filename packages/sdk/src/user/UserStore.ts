import * as path from "node:path";
import KeyvSqlite from "@keyv/sqlite";
import * as Effect from "effect/Effect";
import Keyv from "keyv";
import { fromPromise } from "../effects/io";
import { log } from "../logging";
import type { StoredUser } from "./UserTypes";

const USERS_INDEX_KEY = "users:index";
const DEFAULT_USER_KEY = "users:default";

export const createUserStore = Effect.fn(function* ({
  appsDirectory,
}: {
  appsDirectory: string;
}) {
  let keyv: Keyv;

  const dbPath = path.join(appsDirectory, "users.db");
  const sqlite = new KeyvSqlite(`sqlite://${dbPath}`);
  keyv = new Keyv({ store: sqlite });
  keyv.on("error", (err) => {
    log.error("Database error:", err);
  });
  log.info(`Initialized user storage at ${dbPath}`);
  const getDefaultUsername = Effect.fn(
    function* getDefaultUsername(): Effect.fn.Return<string | null, Error> {
      const stored = yield* fromPromise(() => keyv.get(DEFAULT_USER_KEY));
      if (typeof stored === "string" && stored.length > 0) {
        return stored;
      }
      return null;
    },
  );
  const setDefaultUsername = Effect.fn(function* setDefaultUsername(
    username: string | null,
  ): Effect.fn.Return<void, Error> {
    if (username) {
      yield* fromPromise(() => keyv.set(DEFAULT_USER_KEY, username));
      return;
    }
    yield* fromPromise(() => keyv.delete(DEFAULT_USER_KEY));
  });
  const getUserIndex = Effect.fn(function* getUserIndex(): Effect.fn.Return<
    string[],
    Error
  > {
    const value = yield* fromPromise(() => keyv.get(USERS_INDEX_KEY));
    if (Array.isArray(value)) {
      return value as string[];
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  });
  const getUserRecord = Effect.fn(function* getUserRecord(
    username: string,
  ): Effect.fn.Return<StoredUser | null, Error> {
    const value = yield* fromPromise(() => keyv.get(getUserKey(username)));
    if (!value) return null;
    if (typeof value === "string") {
      try {
        return normalizeStoredUser(JSON.parse(value) as StoredUser);
      } catch {
        return null;
      }
    }
    return normalizeStoredUser(value as StoredUser);
  });
  const saveUserRecord = Effect.fn(function* saveUserRecord(
    user: StoredUser,
  ): Effect.fn.Return<void, Error> {
    yield* fromPromise(() => keyv.set(getUserKey(user.username), user));
    const ids = yield* getUserIndex();
    if (!ids.includes(user.username)) {
      ids.push(user.username);
      yield* setUserIndex(ids);
    }
  });
  const deleteUserRecord = Effect.fn(function* deleteUserRecord(
    username: string,
  ): Effect.fn.Return<void, Error> {
    yield* fromPromise(() => keyv.delete(getUserKey(username)));
    const ids = yield* getUserIndex();
    const next = ids.filter((item) => item !== username);
    yield* setUserIndex(next);
  });
  const setUserIndex = Effect.fn(function* setUserIndex(
    ids: string[],
  ): Effect.fn.Return<void, Error> {
    yield* fromPromise(() => keyv.set(USERS_INDEX_KEY, ids));
  });
  function getUserKey(username: string): string {
    return `user:${username}`;
  }
  function normalizeStoredUser(user: StoredUser): StoredUser {
    if (!Array.isArray(user.grants)) {
      user.grants = [];
    }
    return user;
  }
  const dispose = Effect.fn(function* dispose(): Effect.fn.Return<void, Error> {
    yield* fromPromise(() => keyv.disconnect());
  });
  yield* Effect.addFinalizer(() => dispose().pipe(Effect.orDie));
  return {
    getDefaultUsername,
    setDefaultUsername,
    getUserIndex,
    getUserRecord,
    saveUserRecord,
    deleteUserRecord,
  };
});
export type UserStore = Effect.Success<ReturnType<typeof createUserStore>>;

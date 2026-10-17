import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { openKeyvSqlite } from "../storage/keyv-sqlite";
import type { StoredUser } from "./types";

const USERS_INDEX_KEY = "users:index";
const DEFAULT_USER_KEY = "users:default";

export const createUserStorage = Effect.fn(function* ({
  appsDirectory,
}: {
  appsDirectory: string;
}) {
  const connection = yield* openKeyvSqlite({
    dbPath: path.join(appsDirectory, "users.db"),
    label: "user storage",
    closedMessage: "User storage closed",
  });
  const mutations = yield* Semaphore.make(1);
  const getDefaultUsername = Effect.fn(
    function* getDefaultUsername(): Effect.fn.Return<string | null, Error> {
      const stored = yield* connection.read(DEFAULT_USER_KEY);
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
      yield* connection.write(DEFAULT_USER_KEY, username);
      return;
    }
    yield* connection.remove(DEFAULT_USER_KEY);
  });
  const getUserIndex = Effect.fn(function* getUserIndex(): Effect.fn.Return<
    string[],
    Error
  > {
    const value = yield* connection.read(USERS_INDEX_KEY);
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
    const value = yield* connection.read(getUserKey(username));
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
  function saveUserRecord(user: StoredUser) {
    return mutations.withPermit(
      Effect.gen(function* () {
        yield* connection.write(getUserKey(user.username), user);
        const ids = yield* getUserIndex();
        if (!ids.includes(user.username)) {
          ids.push(user.username);
          yield* connection.write(USERS_INDEX_KEY, ids);
        }
      }).pipe(Effect.uninterruptible),
    );
  }
  function deleteUserRecord(username: string) {
    return mutations.withPermit(
      Effect.gen(function* () {
        yield* connection.remove(getUserKey(username));
        const ids = yield* getUserIndex();
        yield* connection.write(
          USERS_INDEX_KEY,
          ids.filter((item) => item !== username),
        );
      }).pipe(Effect.uninterruptible),
    );
  }
  function getUserKey(username: string): string {
    return `user:${username}`;
  }
  function normalizeStoredUser(user: StoredUser): StoredUser {
    if (!Array.isArray(user.grants)) {
      user.grants = [];
    }
    return user;
  }
  return {
    getDefaultUsername,
    setDefaultUsername,
    getUserIndex,
    getUserRecord,
    saveUserRecord,
    deleteUserRecord,
  };
});
export type UserStorage = Effect.Success<ReturnType<typeof createUserStorage>>;

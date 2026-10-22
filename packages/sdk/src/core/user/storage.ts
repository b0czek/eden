import * as path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { openKeyvSqlite } from "../../platform/storage/keyv-sqlite";
import { AppsDirectory } from "../../runtime/inputs";
import type {
  UserDefaultWriteFailure,
  UserRecordDeleteFailure,
  UserRecordReadFailure,
  UserRecordSaveFailure,
} from "./errors";
import { readStoredUser, readUserIndex } from "./stored-user";
import type { StoredUser } from "./types";

export interface UserStorage {
  getDefaultUsername: () => Effect.Effect<string | null, UserRecordReadFailure>;
  setDefaultUsername: (
    username: string | null,
  ) => Effect.Effect<void, UserDefaultWriteFailure>;
  getUserIndex: () => Effect.Effect<string[], UserRecordReadFailure>;
  getUserRecord: (
    username: string,
  ) => Effect.Effect<StoredUser | null, UserRecordReadFailure>;
  saveUserRecord: (
    user: StoredUser,
  ) => Effect.Effect<void, UserRecordSaveFailure>;
  deleteUserRecord: (
    username: string,
  ) => Effect.Effect<void, UserRecordDeleteFailure>;
}

export const UserStorage = Context.Service<"eden/UserStorage", UserStorage>(
  "eden/UserStorage",
);

const USERS_INDEX_KEY = "users:index";
const DEFAULT_USER_KEY = "users:default";

export const UserStorageLive = Layer.effect(
  UserStorage,
  Effect.gen(function* () {
    const appsDirectory = yield* AppsDirectory;
    const connection = yield* openKeyvSqlite({
      dbPath: path.join(appsDirectory, "users.db"),
      label: "user storage",
      closedMessage: "User storage closed",
    });
    const mutations = yield* Semaphore.make(1);
    const getDefaultUsername = Effect.fn(function* getDefaultUsername() {
      const stored = yield* connection.read(DEFAULT_USER_KEY);
      if (typeof stored === "string" && stored.length > 0) {
        return stored;
      }
      return null;
    });
    const setDefaultUsername = Effect.fn(function* setDefaultUsername(
      username: string | null,
    ) {
      if (username) {
        yield* connection.write(DEFAULT_USER_KEY, username);
        return;
      }
      yield* connection.remove(DEFAULT_USER_KEY);
    });
    const getUserIndex = Effect.fn(function* getUserIndex() {
      const value = yield* connection.read(USERS_INDEX_KEY);
      return readUserIndex(value);
    });
    const getUserRecord = Effect.fn(function* getUserRecord(username: string) {
      const value = yield* connection.read(getUserKey(username));
      return readStoredUser(value);
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
    return {
      getDefaultUsername,
      setDefaultUsername,
      getUserIndex,
      getUserRecord,
      saveUserRecord,
      deleteUserRecord,
    };
  }),
);

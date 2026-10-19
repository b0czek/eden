import { randomBytes } from "node:crypto";
import type { UserProfile, UserRole } from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { fromPromise } from "../effects/io";
import { scopedEvent } from "../events/scoped";
import { hashPassword, verifyPassword } from "./auth";
import {
  ensureDirectoryRestriction,
  normalizeDirectoryRestriction,
} from "./directory-restriction";
import { defaultGrantsForRole, normalizeGrants } from "./grants";
import type { UserStorage } from "./storage";
import type { StoredUser } from "./types";

export const createUsers = Effect.fn(function* ({
  store,
  userDirectory,
  restrictedApps,
}: {
  store: UserStorage;
  userDirectory: string;
  restrictedApps: ReadonlySet<string>;
}) {
  const changed = yield* scopedEvent<UserProfile>();
  let defaultUsername: string | null = null;
  const initialization = yield* Effect.cachedWithTTL(
    Effect.gen(function* () {
      defaultUsername = yield* store.getDefaultUsername();
    }),
    (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
  );
  const listUsers = Effect.fn(function* listUsers(): Effect.fn.Return<
    UserProfile[],
    Error
  > {
    const ids = yield* store.getUserIndex();
    const users: UserProfile[] = [];
    for (const username of ids) {
      const record = yield* store.getUserRecord(username);
      if (record) {
        users.push(toPublicUser(record));
      }
    }
    users.sort((a, b) => a.name.localeCompare(b.name));
    return users;
  });
  const getUser = Effect.fn(function* getUser(
    username: string,
  ): Effect.fn.Return<UserProfile | null, Error> {
    const record = yield* store.getUserRecord(username);
    return record ? toPublicUser(record) : null;
  });
  const createUser = Effect.fn(function* createUser(args: {
    username?: string;
    name: string;
    role?: UserRole;
    password: string;
    grants?: string[];
    directoryRestriction?: string;
  }): Effect.fn.Return<UserProfile, Error> {
    const username = normalizeUsername(args.username, args.name);
    const existing = yield* store.getUserRecord(username);
    if (existing) {
      return yield* Effect.fail(new Error(`User "${username}" already exists`));
    }

    const role = args.role ?? "standard";
    if (role === "vendor") {
      return yield* Effect.fail(new Error("Vendor account can only be seeded"));
    }
    const { passwordHash, passwordSalt } = yield* hashPassword(args.password);
    const now = Date.now();

    const grants = normalizeUserGrants(
      role,
      args.grants ?? defaultGrantsForRole(role),
    );
    const directoryRestriction = yield* ensureDirectoryRestriction(
      userDirectory,
      role,
      args.directoryRestriction,
    );

    const user: StoredUser = {
      username,
      name: args.name,
      role,
      directoryRestriction,
      grants,
      createdAt: now,
      updatedAt: now,
      passwordHash,
      passwordSalt,
    };

    return yield* saveUser(user);
  });
  const updateUser = Effect.fn(function* updateUser(args: {
    username: string;
    name?: string;
    role?: UserRole;
    grants?: string[];
    directoryRestriction?: string | null;
  }): Effect.fn.Return<UserProfile, Error> {
    const user = yield* requireUserRecord(args.username);

    if (user.role === "vendor" && args.role && args.role !== "vendor") {
      return yield* Effect.fail(new Error("Vendor role cannot be changed"));
    }
    if (args.role === "vendor" && user.role !== "vendor") {
      return yield* Effect.fail(new Error("Vendor account can only be seeded"));
    }

    if (args.name) {
      user.name = args.name;
    }

    if (args.role) {
      user.role = args.role;
      user.grants = normalizeUserGrants(user.role, user.grants);
    }

    if (args.grants) {
      user.grants = normalizeUserGrants(user.role, args.grants);
    }

    if (args.directoryRestriction !== undefined) {
      const directoryRestriction = yield* ensureDirectoryRestriction(
        userDirectory,
        user.role,
        args.directoryRestriction,
      );
      if (directoryRestriction) {
        user.directoryRestriction = directoryRestriction;
      } else {
        delete user.directoryRestriction;
      }
    } else if (user.directoryRestriction) {
      user.directoryRestriction = normalizeDirectoryRestriction(
        user.directoryRestriction,
      );
    }

    user.updatedAt = Date.now();

    return yield* saveUser(user);
  });
  const deleteUser = Effect.fn(function* deleteUser(
    username: string,
  ): Effect.fn.Return<void, Error> {
    const user = yield* requireUserRecord(username);
    if (user.role === "vendor") {
      return yield* Effect.fail(new Error("Vendor account cannot be deleted"));
    }

    yield* store.deleteUserRecord(username);
  });
  const setPassword = Effect.fn(function* setPassword(
    username: string,
    password: string,
  ): Effect.fn.Return<UserProfile, Error> {
    const user = yield* requireUserRecord(username);
    const { passwordHash, passwordSalt } = yield* hashPassword(password);
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.updatedAt = Date.now();
    return yield* saveUser(user);
  });
  const changePassword = Effect.fn(function* changePassword(
    username: string,
    currentPassword: string,
    newPassword: string,
  ): Effect.fn.Return<UserProfile, Error> {
    const user = yield* requireUserRecord(username);
    const valid = yield* verifyPassword(
      currentPassword,
      user.passwordSalt,
      user.passwordHash,
    );
    if (!valid) {
      return yield* Effect.fail(new Error("Invalid password"));
    }

    const { passwordHash, passwordSalt } = yield* hashPassword(newPassword);
    user.passwordHash = passwordHash;
    user.passwordSalt = passwordSalt;
    user.updatedAt = Date.now();
    return yield* saveUser(user);
  });
  const authenticate = Effect.fn(function* authenticate(
    username: string,
    password: string,
  ): Effect.fn.Return<UserProfile, Error> {
    const user = yield* requireUserRecord(username);

    if (
      !(yield* verifyPassword(password, user.passwordSalt, user.passwordHash))
    ) {
      return yield* Effect.fail(new Error("Invalid credentials"));
    }

    return toPublicUser(user);
  });
  function getDefaultUsername(): string | null {
    return defaultUsername;
  }
  const setDefaultUsername = Effect.fn(function* setDefaultUsername(
    username: string | null,
  ): Effect.fn.Return<void, Error> {
    if (!username) {
      defaultUsername = null;
      yield* store.setDefaultUsername(null);
      return;
    }

    const user = yield* store.getUserRecord(username);
    if (!user) {
      return yield* Effect.fail(new Error(`User "${username}" not found`));
    }

    defaultUsername = username;
    yield* store.setDefaultUsername(username);
  });
  function normalizeUsername(
    username: string | undefined,
    name: string,
  ): string {
    if (username && username.trim().length > 0) {
      return username.trim();
    }
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    const suffix = randomBytes(2).toString("hex");
    return `${slug || "user"}-${suffix}`;
  }
  const requireUserRecord = Effect.fn(function* requireUserRecord(
    username: string,
  ): Effect.fn.Return<StoredUser, Error> {
    const record = yield* store.getUserRecord(username);
    if (!record) {
      return yield* Effect.fail(new Error(`User "${username}" not found`));
    }
    return record;
  });
  function toPublicUser(user: StoredUser): UserProfile {
    return {
      username: user.username,
      name: user.name,
      role: user.role,
      directoryRestriction: user.directoryRestriction,
      grants: user.grants,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
  function saveUser(user: StoredUser) {
    return Effect.uninterruptible(
      Effect.gen(function* () {
        yield* store.saveUserRecord(user);
        const profile = toPublicUser(user);
        changed.emit(profile);
        return profile;
      }),
    );
  }
  const getDefaultUser = Effect.fn(function* getDefaultUser(): Effect.fn.Return<
    UserProfile | null,
    Error
  > {
    if (!defaultUsername) return null;
    const user = yield* store.getUserRecord(defaultUsername);
    return user ? toPublicUser(user) : null;
  });
  function normalizeUserGrants(role: UserRole, grants: string[]): string[] {
    const normalized = normalizeGrants(role, grants);
    return filterRestrictedAppGrants(role, normalized);
  }
  function filterRestrictedAppGrants(
    role: UserRole,
    grants: string[],
  ): string[] {
    if (role === "vendor" || restrictedApps.size === 0) {
      return grants;
    }

    return grants.filter((grant) => {
      if (!grant.startsWith("apps/launch/")) {
        return true;
      }

      const appId = grant.slice("apps/launch/".length);
      if (!appId || appId === "*") {
        return true;
      }
      return !restrictedApps.has(appId);
    });
  }

  return {
    changed,
    initialize: () => initialization,
    listUsers,
    getUser,
    createUser,
    updateUser,
    deleteUser,
    setPassword,
    changePassword,
    authenticate,
    getDefaultUsername,
    setDefaultUsername,
    getDefaultUser,
  };
});
export type Users = Effect.Success<ReturnType<typeof createUsers>>;

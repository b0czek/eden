import type { UserProfile } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { UserDirectory } from "../../runtime/inputs";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import { hashPassword, verifyPassword } from "./auth";
import {
  directoryValidationFailure,
  ensureDirectoryRestriction,
  normalizeDirectoryRestriction,
} from "./directory-restriction";
import {
  type AuthenticateUserFailure,
  type ChangePasswordFailure,
  type CreateUserFailure,
  type DeleteUserFailure,
  InvalidUserPasswordError,
  type SetDefaultUserFailure,
  type SetPasswordFailure,
  type UpdateUserFailure,
  UserAlreadyExistsError,
  UserNotFoundError,
  type UserRecordReadFailure,
  VendorAccountPolicyError,
} from "./errors";
import { defaultGrantsForRole } from "./grants";
import {
  normalizeUserGrants,
  normalizeUsername,
  toPublicUser,
} from "./profile";
import { UserStorage } from "./storage";
import type { CreateUser, StoredUser, UpdateUser } from "./types";

export interface Users {
  changed: Event<UserProfile>;
  initialize: () => Effect.Effect<void, UserRecordReadFailure>;
  listUsers: () => Effect.Effect<UserProfile[], UserRecordReadFailure>;
  getUser: (
    username: string,
  ) => Effect.Effect<UserProfile | null, UserRecordReadFailure>;
  createUser: (
    args: CreateUser,
  ) => Effect.Effect<UserProfile, CreateUserFailure>;
  updateUser: (
    args: UpdateUser,
  ) => Effect.Effect<UserProfile, UpdateUserFailure>;
  deleteUser: (username: string) => Effect.Effect<void, DeleteUserFailure>;
  setPassword: (
    username: string,
    password: string,
  ) => Effect.Effect<UserProfile, SetPasswordFailure>;
  changePassword: (
    username: string,
    currentPassword: string,
    newPassword: string,
  ) => Effect.Effect<UserProfile, ChangePasswordFailure>;
  authenticate: (
    username: string,
    password: string,
  ) => Effect.Effect<UserProfile, AuthenticateUserFailure>;
  getDefaultUsername: () => string | null;
  setDefaultUsername: (
    username: string | null,
  ) => Effect.Effect<void, SetDefaultUserFailure>;
  getDefaultUser: () => Effect.Effect<
    UserProfile | null,
    UserRecordReadFailure
  >;
}

export const Users = Context.Service<"eden/Users", Users>("eden/Users");

export const UsersRestrictedApps = Context.Service<
  "eden/UsersRestrictedApps",
  ReadonlySet<string>
>("eden/UsersRestrictedApps");

export const UsersLive = Layer.effect(
  Users,
  Effect.gen(function* () {
    const store = yield* UserStorage;
    const userDirectory = yield* UserDirectory;
    const restrictedApps = yield* UsersRestrictedApps;
    const changed = yield* scopedEvent<UserProfile>();
    let defaultUsername: string | null = null;
    const initialization = yield* Effect.cachedWithTTL(
      Effect.gen(function* () {
        defaultUsername = yield* store.getDefaultUsername();
      }),
      (exit) => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
    );
    const listUsers = Effect.fn(function* listUsers() {
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
    const getUser = Effect.fn(function* getUser(username: string) {
      const record = yield* store.getUserRecord(username);
      return record ? toPublicUser(record) : null;
    });
    const createUser = Effect.fn(function* createUser(args: CreateUser) {
      const username = normalizeUsername(args.username, args.name);
      const existing = yield* store.getUserRecord(username);
      if (existing) {
        return yield* Effect.fail(new UserAlreadyExistsError({ username }));
      }

      const role = args.role ?? "standard";
      if (role === "vendor") {
        return yield* Effect.fail(
          new VendorAccountPolicyError({ action: "create" }),
        );
      }
      const { passwordHash, passwordSalt } = yield* hashPassword(args.password);
      const now = Date.now();

      const grants = normalizeUserGrants(
        role,
        args.grants ?? defaultGrantsForRole(role),
        restrictedApps,
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
    const updateUser = Effect.fn(function* updateUser(args: UpdateUser) {
      const user = yield* requireUserRecord(args.username);

      if (user.role === "vendor" && args.role && args.role !== "vendor") {
        return yield* Effect.fail(
          new VendorAccountPolicyError({ action: "change-role" }),
        );
      }
      if (args.role === "vendor" && user.role !== "vendor") {
        return yield* Effect.fail(
          new VendorAccountPolicyError({ action: "create" }),
        );
      }

      if (args.name) {
        user.name = args.name;
      }

      if (args.role) {
        user.role = args.role;
        user.grants = normalizeUserGrants(
          user.role,
          user.grants,
          restrictedApps,
        );
      }

      if (args.grants) {
        user.grants = normalizeUserGrants(
          user.role,
          args.grants,
          restrictedApps,
        );
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
        user.directoryRestriction = yield* Effect.try({
          try: () => normalizeDirectoryRestriction(user.directoryRestriction),
          catch: directoryValidationFailure,
        });
      }

      user.updatedAt = Date.now();

      return yield* saveUser(user);
    });
    const deleteUser = Effect.fn(function* deleteUser(username: string) {
      const user = yield* requireUserRecord(username);
      if (user.role === "vendor") {
        return yield* Effect.fail(
          new VendorAccountPolicyError({ action: "delete" }),
        );
      }

      yield* store.deleteUserRecord(username);
    });
    const setPassword = Effect.fn(function* setPassword(
      username: string,
      password: string,
    ) {
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
    ) {
      const user = yield* requireUserRecord(username);
      const valid = yield* verifyPassword(
        currentPassword,
        user.passwordSalt,
        user.passwordHash,
      );
      if (!valid) {
        return yield* Effect.fail(
          new InvalidUserPasswordError({
            username,
            purpose: "change-password",
          }),
        );
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
    ) {
      const user = yield* requireUserRecord(username);

      if (
        !(yield* verifyPassword(password, user.passwordSalt, user.passwordHash))
      ) {
        return yield* Effect.fail(
          new InvalidUserPasswordError({ username, purpose: "authenticate" }),
        );
      }

      return toPublicUser(user);
    });
    function getDefaultUsername(): string | null {
      return defaultUsername;
    }
    const setDefaultUsername = Effect.fn(function* setDefaultUsername(
      username: string | null,
    ) {
      if (username) {
        yield* requireUserRecord(username);
      }
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* store.setDefaultUsername(username || null);
          defaultUsername = username || null;
        }),
      );
    });
    const requireUserRecord = Effect.fn(function* requireUserRecord(
      username: string,
    ) {
      const record = yield* store.getUserRecord(username);
      if (!record) {
        return yield* Effect.fail(new UserNotFoundError({ username }));
      }
      return record;
    });
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
    const getDefaultUser = Effect.fn(function* getDefaultUser() {
      if (!defaultUsername) return null;
      const user = yield* store.getUserRecord(defaultUsername);
      return user ? toPublicUser(user) : null;
    });

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
  }),
);

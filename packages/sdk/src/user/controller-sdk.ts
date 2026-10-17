import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EdenUsersApi } from "../api/control-plane";
import type { SdkContext } from "../api/sdk-context";
import type { Sessions } from "../session/service";
import {
  createUserSchema,
  defaultUsernameSchema,
  setUserPasswordSchema,
  updateUserSchema,
  usernameSchema,
} from "./schemas";
import type { Users } from "./service";

export function createUsersSdkController({
  users,
  sessions,
  sdk,
}: {
  users: Users;
  sessions: Sessions;
  sdk: SdkContext;
}): EdenUsersApi {
  return {
    list: () =>
      sdk.effect(() => Effect.map(users.listUsers(), structuredClone)),
    get: (username) =>
      sdk.effect(() =>
        Effect.map(
          users.getUser(v.parse(usernameSchema, username)),
          structuredClone,
        ),
      ),
    create: (input) =>
      sdk.effect(() =>
        Effect.map(
          users.createUser(structuredClone(v.parse(createUserSchema, input))),
          structuredClone,
        ),
      ),
    update: (input) =>
      sdk.effect(() => {
        const args = structuredClone(v.parse(updateUserSchema, input));
        return Effect.gen(function* () {
          const user = yield* users.updateUser(args);
          sessions.synchronizeUser(user);
          return structuredClone(user);
        });
      }),
    delete: (username) =>
      sdk.effect(() => users.deleteUser(v.parse(usernameSchema, username))),
    setPassword: (username, password) =>
      sdk.effect(() => {
        const args = v.parse(setUserPasswordSchema, { username, password });
        return Effect.gen(function* () {
          const user = yield* users.setPassword(args.username, args.password);
          sessions.synchronizeUser(user);
        });
      }),
    getDefaultUsername: () => sdk.run(() => users.getDefaultUsername()),
    setDefaultUsername: (username) =>
      sdk.effect(() =>
        users.setDefaultUsername(v.parse(defaultUsernameSchema, username)),
      ),
  };
}

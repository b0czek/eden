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
      sdk.run(async () => structuredClone(await sdk.effect(users.listUsers()))),
    get: async (username) => {
      const input = v.parse(usernameSchema, username);
      return sdk.run(async () => {
        const user = await sdk.effect(users.getUser(input));
        return user ? structuredClone(user) : null;
      });
    },
    create: async (input) => {
      const args = structuredClone(v.parse(createUserSchema, input));
      return sdk.run(async () =>
        structuredClone(await sdk.effect(users.createUser(args))),
      );
    },
    update: async (input) => {
      const args = structuredClone(v.parse(updateUserSchema, input));
      return sdk.run(async () => {
        const user = await sdk.effect(users.updateUser(args));
        sessions.synchronizeUser(user);
        return structuredClone(user);
      });
    },
    delete: async (username) => {
      const input = v.parse(usernameSchema, username);
      return sdk.run(() => sdk.effect(users.deleteUser(input)));
    },
    setPassword: async (username, password) => {
      const args = v.parse(setUserPasswordSchema, { username, password });
      return sdk.run(async () => {
        const user = await sdk.effect(
          users.setPassword(args.username, args.password),
        );
        sessions.synchronizeUser(user);
      });
    },
    getDefaultUsername: () => sdk.run(() => users.getDefaultUsername()),
    setDefaultUsername: async (username) => {
      const input = v.parse(defaultUsernameSchema, username);
      return sdk.run(() => sdk.effect(users.setDefaultUsername(input)));
    },
  };
}

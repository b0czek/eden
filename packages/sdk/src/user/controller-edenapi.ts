import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command, defineController } from "../controllers/controller";
import type { ExecutionContext } from "../execution/context";
import type { GrantCatalog } from "./grant-catalog";
import {
  createUserSchema,
  defaultUsernameSchema,
  passwordSchema,
  setUserPasswordSchema,
  updateUserSchema,
  usernameSchema,
} from "./schemas";
import type { Users } from "./service";

export function createUserController({
  users,
  execution,
  grants,
}: {
  users: Users;
  execution: ExecutionContext;
  grants: GrantCatalog;
}) {
  function assertVendor() {
    if (!execution.isVendor()) throw new Error("Vendor account required");
  }
  return defineController("user", {
    commands: {
      "grant-options": command({
        permission: "manage",
        handle: () => {
          assertVendor();
          return grants.getOptions();
        },
      }),
      list: command({
        permission: "identity",
        handle: () => Effect.map(users.listUsers(), (users) => ({ users })),
      }),
      create: command({
        permission: "manage",
        input: createUserSchema,
        handle: (args) => {
          assertVendor();
          return Effect.map(users.createUser(args), (user) => ({ user }));
        },
      }),
      update: command({
        permission: "manage",
        input: updateUserSchema,
        handle: (args) => {
          assertVendor();
          return Effect.map(users.updateUser(args), (user) => ({ user }));
        },
      }),
      delete: command({
        permission: "manage",
        input: v.object({ username: usernameSchema }),
        handle: ({ username }) => {
          assertVendor();
          return Effect.map(
            users.deleteUser(username),
            (): { success: boolean } => ({ success: true }),
          );
        },
      }),
      "set-password": command({
        permission: "manage",
        input: setUserPasswordSchema,
        handle: ({ username, password }) => {
          assertVendor();
          return Effect.map(
            users.setPassword(username, password),
            (): { success: boolean } => ({ success: true }),
          );
        },
      }),
      "change-password": command({
        permission: "session",
        input: v.object({
          currentPassword: passwordSchema,
          newPassword: passwordSchema,
        }),
        handle: ({ currentPassword, newPassword }) =>
          Effect.gen(function* () {
            const principal = execution.getPrincipal();
            if (principal?.kind !== "user")
              return yield* Effect.fail(new Error("No active user session"));
            yield* users.changePassword(
              principal.profile.username,
              currentPassword,
              newPassword,
            );
            return { success: true } as { success: boolean; error?: string };
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed({ success: false, error: error.message }),
            ),
          ),
      }),
      "has-grant": command({
        permission: "grants",
        input: v.object({ grant: v.string() }),
        handle: ({ grant }) => ({ allowed: execution.hasGrant(grant) }),
      }),
      "get-default": command({
        permission: "manage",
        handle: () => {
          assertVendor();
          return { username: users.getDefaultUsername() };
        },
      }),
      "set-default": command({
        permission: "manage",
        input: v.object({ username: defaultUsernameSchema }),
        handle: ({ username }) => {
          assertVendor();
          return Effect.map(
            users.setDefaultUsername(username),
            (): { success: boolean } => ({ success: true }),
          );
        },
      }),
    },
    events: { "grant-options-changed": grants.changed },
  });
}

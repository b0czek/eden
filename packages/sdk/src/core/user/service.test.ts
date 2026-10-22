import * as Effect from "effect/Effect";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import {
  StorageReadError,
  StorageWriteError,
} from "../../platform/storage/errors";
import { UserDirectory } from "../../runtime/inputs";
import { Users, UsersLive, UsersRestrictedApps } from "./service";
import { UserStorage } from "./storage";

it("retries failed initialization before publishing the configured default username", async () => {
  const runtime = createEffectRuntime();
  const failure = new StorageReadError({
    resource: "users.db",
    operation: "read",
    keys: ["users:default"],
    cause: new Error("Default user storage unavailable"),
  });
  let unavailable = true;
  const store: UserStorage = {
    getDefaultUsername: () =>
      Effect.suspend(() =>
        unavailable ? Effect.fail(failure) : Effect.succeed("operator"),
      ),
    setDefaultUsername: () => Effect.void,
    getUserIndex: () => Effect.succeed([]),
    getUserRecord: () => Effect.succeed(null),
    saveUserRecord: () => Effect.void,
    deleteUserRecord: () => Effect.void,
  };
  try {
    const users = await runtime.acquire(
      buildService(Users, UsersLive).pipe(
        Effect.provideService(UserStorage, store),
        Effect.provideService(UserDirectory, "/unused"),
        Effect.provideService(UsersRestrictedApps, new Set()),
      ),
    );
    await expect(runtime.run(users.initialize())).rejects.toBe(failure);
    expect(users.getDefaultUsername()).toBeNull();
    unavailable = false;
    await runtime.run(users.initialize());
    expect(users.getDefaultUsername()).toBe("operator");
  } finally {
    await runtime.dispose();
  }
});

it("keeps the committed default selection when persistence rejects a new selection", async () => {
  const runtime = createEffectRuntime();
  const failure = new StorageWriteError({
    resource: "users.db",
    key: "users:default",
    cause: new Error("Disk full"),
  });
  const store: UserStorage = {
    getDefaultUsername: () => Effect.succeed("operator"),
    setDefaultUsername: () => Effect.fail(failure),
    getUserIndex: () => Effect.succeed([]),
    getUserRecord: () => Effect.succeed(null),
    saveUserRecord: () => Effect.void,
    deleteUserRecord: () => Effect.void,
  };
  try {
    const users = await runtime.acquire(
      buildService(Users, UsersLive).pipe(
        Effect.provideService(UserStorage, store),
        Effect.provideService(UserDirectory, "/unused"),
        Effect.provideService(UsersRestrictedApps, new Set()),
      ),
    );
    await runtime.run(users.initialize());
    await expect(runtime.run(users.setDefaultUsername(null))).rejects.toBe(
      failure,
    );
    expect(users.getDefaultUsername()).toBe("operator");
  } finally {
    await runtime.dispose();
  }
});

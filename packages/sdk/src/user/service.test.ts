import * as Effect from "effect/Effect";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import { createUsers } from "./service";
import type { UserStorage } from "./storage";

it("retries failed initialization before publishing the configured default username", async () => {
  const runtime = createEffectRuntime();
  const failure = new Error("Default user storage unavailable");
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
      createUsers({
        store,
        userDirectory: "/unused",
        restrictedApps: new Set(),
      }),
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

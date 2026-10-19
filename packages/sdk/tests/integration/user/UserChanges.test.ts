import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { createSdkContext } from "../../../src/api/sdk-context";
import { createExecutionContext } from "../../../src/execution/context";
import { createOperations } from "../../../src/operations/service";
import { createSessionContext } from "../../../src/session/context";
import { createSessions } from "../../../src/session/service";
import { createUsersSdkController } from "../../../src/user/controller-sdk";
import { createUsers } from "../../../src/user/service";
import { createUserStorage } from "../../../src/user/storage";
import { createEffectRuntime } from "../../support/effect-runtime";

it("refreshes active grants after a committed user update even when its caller is interrupted", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-user-change-"),
  );
  const effects = createEffectRuntime();
  const committed = Deferred.makeUnsafe<void>();
  const settled = Deferred.makeUnsafe<void>();
  try {
    const store = await effects.acquire(
      createUserStorage({ appsDirectory: directory }),
    );
    const profile = {
      username: "operator",
      name: "Operator",
      role: "standard" as const,
      grants: ["*"],
      createdAt: 1,
      updatedAt: 1,
    };
    await effects.run(
      store.saveUserRecord({ ...profile, passwordHash: "", passwordSalt: "" }),
    );
    const users = await effects.acquire(
      createUsers({
        userDirectory: directory,
        restrictedApps: new Set(),
        store: {
          ...store,
          saveUserRecord: (user) =>
            Effect.gen(function* () {
              yield* store.saveUserRecord(user);
              yield* Deferred.succeed(committed, undefined);
              yield* Deferred.await(settled);
            }).pipe(Effect.uninterruptible),
        },
      }),
    );
    const context = createSessionContext();
    context.beginSession(profile);
    const execution = createExecutionContext({ config: {} });
    const operations = await effects.acquire(
      createOperations({
        execution,
        session: context,
        filesystem: { releaseHandles: () => Effect.void },
      }),
    );
    const sessions = await effects.acquire(
      createSessions({
        users,
        context,
        operations,
        processes: { stopSessionApps: () => Effect.void },
      }),
    );
    const api = createUsersSdkController({
      users,
      sdk: createSdkContext({ execution, operations }),
    });
    const updating = effects.fork(
      api.update({ username: "operator", grants: [] }),
    );
    await effects.run(Deferred.await(committed));
    updating.interruptUnsafe();
    await effects.run(Deferred.succeed(settled, undefined));
    await effects.run(Fiber.await(updating));

    expect(
      (await effects.run(store.getUserRecord("operator")))?.grants,
    ).toEqual([]);
    expect(sessions.getCurrentUser()?.grants).toEqual([]);
  } finally {
    Deferred.doneUnsafe(settled, Effect.void);
    await effects.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

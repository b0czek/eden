import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { createSdkContext } from "../../../src/api/sdk-context";
import { Processes } from "../../../src/applications/processes/service";
import {
  ExecutionContext,
  ExecutionContextLive,
} from "../../../src/core/execution/context";
import {
  Operations,
  OperationsLive,
} from "../../../src/core/operations/service";
import { createUsersSdkController } from "../../../src/core/user/controller-sdk";
import {
  Users,
  UsersLive,
  UsersRestrictedApps,
} from "../../../src/core/user/service";
import { UserStorage, UserStorageLive } from "../../../src/core/user/storage";
import {
  SessionContext,
  SessionContextLive,
} from "../../../src/desktop/session/context";
import { Sessions, SessionsLive } from "../../../src/desktop/session/service";
import { Filesystem } from "../../../src/platform/filesystem/service";
import {
  AppsDirectory,
  RuntimeConfig,
  UserDirectory,
} from "../../../src/runtime/inputs";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

it("refreshes active grants after a committed user update even when its caller is interrupted", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-user-change-"),
  );
  const effects = createEffectRuntime();
  const committed = Deferred.makeUnsafe<void>();
  const settled = Deferred.makeUnsafe<void>();
  try {
    const store = await effects.acquire(
      buildService(UserStorage, UserStorageLive).pipe(
        Effect.provideService(AppsDirectory, directory),
      ),
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
      buildService(Users, UsersLive).pipe(
        Effect.provideService(UserStorage, {
          ...store,
          saveUserRecord: (user) =>
            Effect.gen(function* () {
              yield* store.saveUserRecord(user);
              yield* Deferred.succeed(committed, undefined);
              yield* Deferred.await(settled);
            }).pipe(Effect.uninterruptible),
        }),
        Effect.provideService(UserDirectory, directory),
        Effect.provideService(UsersRestrictedApps, new Set()),
      ),
    );
    const context = serviceEffects.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    context.beginSession(profile);
    const execution = serviceEffects.acquireSync(
      buildService(ExecutionContext, ExecutionContextLive).pipe(
        Effect.provideService(RuntimeConfig, {}),
      ),
    );
    const operations = await effects.acquire(
      buildService(Operations, OperationsLive).pipe(
        Effect.provideService(ExecutionContext, execution),
        Effect.provideService(SessionContext, context),
        Effect.provide(
          Layer.mock(Filesystem, {
            getBaseDir: unused,
            changed: unusedEvent,
            accessScope: unused,
            prepareVolumeOperation: unused,
            unwatch: unused,
            releaseHandles: () => Effect.void,
          }),
        ),
      ),
    );
    const sessions = await effects.acquire(
      buildService(Sessions, SessionsLive).pipe(
        Effect.provideService(Users, users),
        Effect.provideService(SessionContext, context),
        Effect.provideService(Operations, operations),
        Effect.provide(
          Layer.mock(Processes, {
            launched: unusedEvent,
            stopped: unusedEvent,
            reloading: unusedEvent,
            error: unusedEvent,
            exited: unusedEvent,
            assertCanLaunch: unused,
            getRunningApps: unused,
            getAppInstance: unused,
            getInstalledManifest: unused,
            stopSessionApps: () => Effect.void,
          }),
        ),
      ),
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

function unused(): never {
  throw new Error("Unexpected collaborator operation");
}
const unusedEvent = {
  on: unused,
  emit: unused,
  dispose: unused,
  hasListeners: unused,
};

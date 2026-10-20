import type {
  AppInstance,
  FilesystemChangeKind,
  UserProfile,
} from "@edenapp/types";
import type { TargetedNotification } from "../controllers/events";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { Filesystem } from "../filesystem/service";
import { Processes } from "../processes/service";
import { Users } from "../user/service";
import { InvalidUserPasswordError } from "../user/errors";
import { SessionProcessesStopFailed } from "../processes/errors";
import { SessionTransitionInProgress } from "../operations/errors";
import { gate } from "../../tests/support/async";
import {
  buildService,
  createEffectRuntime,
  type EffectRuntime,
} from "../../tests/support/effect-runtime";
import { fromPromise } from "../effects/io";
import { createEvent, type Event } from "../events/event";
import { ExecutionContext, ExecutionContextLive } from "../execution/context";
import { Operations, OperationsLive } from "../operations/service";
import { RuntimeConfig } from "../runtime/inputs";
import { SessionContext, SessionContextLive } from "./context";
import { Sessions, SessionsLive } from "./service";

function unexpectedDependencyUse(): never {
  throw new Error("Unexpected dependency use in session fixture");
}

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

const createUser = (username: string): UserProfile => ({
  username,
  name: username,
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
});

describe("Sessions", () => {
  const alice = createUser("alice");
  const bob = createUser("bob");
  let context: SessionContext;
  let users: {
    changed: Event<UserProfile>;
    authenticate: jest.Mock;
    getDefaultUser: jest.Mock;
  };
  let processes: { stopSessionApps: jest.Mock };
  let notify: jest.Mock;
  let sessions: Sessions;
  let operations: Operations;
  let effects: EffectRuntime;

  beforeEach(async () => {
    context = serviceEffects.acquireSync(
      buildService(SessionContext, SessionContextLive),
    );
    users = {
      changed: createEvent<UserProfile>(),
      authenticate: jest.fn(),
      getDefaultUser: jest.fn().mockReturnValue(Effect.succeed(null)),
    };
    processes = {
      stopSessionApps: jest.fn().mockReturnValue(Effect.void),
    };
    notify = jest.fn();
    effects = createEffectRuntime();
    operations = await effects.acquire(
      buildService(Operations, OperationsLive).pipe(
        Effect.provideService(
          ExecutionContext,
          serviceEffects.acquireSync(
            buildService(ExecutionContext, ExecutionContextLive).pipe(
              Effect.provideService(RuntimeConfig, {}),
            ),
          ),
        ),
        Effect.provideService(SessionContext, context),
        Effect.provide(
          Layer.mock(Filesystem, {
            releaseHandles: () => Effect.void,
            getBaseDir: unexpectedDependencyUse,
            changed:
              createEvent<
                TargetedNotification<{
                  watchId: string;
                  kind: FilesystemChangeKind;
                }>
              >(),
            accessScope: unexpectedDependencyUse,
            prepareVolumeOperation: unexpectedDependencyUse,
            unwatch: unexpectedDependencyUse,
          }),
        ),
      ),
    );
    sessions = await effects.acquire(
      buildService(Sessions, SessionsLive).pipe(
        Effect.provide(
          Layer.mock(Users, {
            ...users,
            getDefaultUsername: unexpectedDependencyUse,
          }),
        ),
        Effect.provideService(SessionContext, context),
        Effect.provideService(Operations, operations),
        Effect.provide(
          Layer.mock(Processes, {
            ...processes,
            launched: createEvent<{ instance: AppInstance }>(),
            stopped: createEvent<{ appId: string }>(),
            reloading: createEvent<{ appId: string }>(),
            error: createEvent<{ appId: string; error: unknown }>(),
            exited: createEvent<{ appId: string; code: number }>(),
            assertCanLaunch: unexpectedDependencyUse,
            getRunningApps: unexpectedDependencyUse,
            getAppInstance: unexpectedDependencyUse,
            getInstalledManifest: unexpectedDependencyUse,
          }),
        ),
      ),
    );
    sessions.changed.on(notify);
  });

  afterEach(async () => {
    await effects.dispose();
  });

  it("does not stop apps or change identity when authentication fails", async () => {
    context.setCurrentUser(alice);
    users.authenticate.mockReturnValue(
      Effect.fail(
        new InvalidUserPasswordError({
          username: "bob",
          purpose: "authenticate",
        }),
      ),
    );

    await expect(
      effects.run(sessions.login("bob", "wrong")),
    ).rejects.toMatchObject({
      _tag: "InvalidUserPasswordError",
      username: "bob",
      purpose: "authenticate",
    });
    expect(processes.stopSessionApps).not.toHaveBeenCalled();
    expect(sessions.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps the old identity when app shutdown fails", async () => {
    context.setCurrentUser(alice);
    users.authenticate.mockReturnValue(Effect.succeed(bob));
    processes.stopSessionApps.mockReturnValue(
      Effect.fail(
        new SessionProcessesStopFailed({
          sessionId: context.getSessionId(),
          cause: new AggregateError([]),
          message: "shutdown failed",
        }),
      ),
    );

    await expect(
      effects.run(sessions.login("bob", "password")),
    ).rejects.toMatchObject({
      _tag: "SessionProcessesStopFailed",
      sessionId: context.getSessionId(),
      message: "shutdown failed",
    });
    expect(sessions.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects concurrent transitions", async () => {
    const authentication = gate<UserProfile>();
    users.authenticate.mockReturnValue(
      fromPromise(() => authentication.promise),
    );

    const login = effects.run(sessions.login("alice", "password"));
    await expect(effects.run(sessions.logout())).rejects.toBeInstanceOf(
      SessionTransitionInProgress,
    );
    authentication.release(alice);
    await login;
  });

  it("refreshes the same identity without stopping apps", async () => {
    context.setCurrentUser(alice);
    const refreshed = { ...alice, name: "Alice Updated", updatedAt: 2 };
    users.authenticate.mockReturnValue(Effect.succeed(refreshed));

    await effects.run(sessions.login("alice", "password"));

    expect(processes.stopSessionApps).not.toHaveBeenCalled();
    expect(sessions.getCurrentUser()).toEqual(refreshed);
  });

  it("activates the configured default user during initialization", async () => {
    users.getDefaultUser.mockReturnValue(Effect.succeed(alice));

    await effects.run(sessions.initialize());

    expect(processes.stopSessionApps).toHaveBeenCalledTimes(1);
    expect(sessions.getCurrentUser()).toEqual(alice);
    expect(notify).toHaveBeenCalledWith({
      currentUser: alice,
      previousUsername: null,
      reason: "system",
    });
  });

  it("waits for the same default-session transition across concurrent initialization calls", async () => {
    const stopping = Deferred.makeUnsafe<void>();
    const stopped = Deferred.makeUnsafe<void>();
    users.getDefaultUser.mockReturnValue(Effect.succeed(alice));
    processes.stopSessionApps.mockReturnValue(
      Effect.andThen(
        Deferred.succeed(stopping, undefined),
        Deferred.await(stopped),
      ),
    );
    const first = effects.fork(sessions.initialize());
    await effects.run(Deferred.await(stopping));
    const second = effects.fork(sessions.initialize());
    try {
      expect(second.pollUnsafe()).toBeUndefined();
      expect(sessions.getCurrentUser()).toBeNull();
    } finally {
      await effects.run(Deferred.succeed(stopped, undefined));
    }
    await effects.run(Fiber.join(first));
    await effects.run(Fiber.join(second));
    await effects.run(sessions.initialize());
    expect(sessions.getCurrentUser()).toEqual(alice);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

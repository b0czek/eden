import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { gate } from "../../tests/support/async";
import { fromPromise } from "../effects/io";
import { createEffectRuntime, type EffectRuntime } from "../effects/runtime";
import { createExecutionContext } from "../execution/context";
import { createOperations, type Operations } from "../operations/service";
import { createSessionContext, type SessionContext } from "./context";
import { createSessions, type Sessions } from "./service";

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
    authenticate: jest.Mock;
    getDefaultUser: jest.Mock;
  };
  let processes: { stopSessionApps: jest.Mock };
  let notify: jest.Mock;
  let sessions: Sessions;
  let operations: Operations;
  let effects: EffectRuntime;

  beforeEach(async () => {
    context = createSessionContext();
    users = {
      authenticate: jest.fn(),
      getDefaultUser: jest.fn().mockReturnValue(Effect.succeed(null)),
    };
    processes = {
      stopSessionApps: jest.fn().mockReturnValue(Effect.void),
    };
    notify = jest.fn();
    effects = createEffectRuntime();
    operations = createOperations({
      effects,
      execution: createExecutionContext({ config: {} }),
      session: context,
      filesystem: { releaseHandles: () => Effect.void },
    });
    sessions = await effects.acquire(
      createSessions({
        users,
        processes,
        context,
        operations,
      }),
    );
    sessions.changed.on(notify);
  });

  afterEach(async () => {
    await effects.run(operations.dispose());
    await effects.dispose();
  });

  it("does not stop apps or change identity when authentication fails", async () => {
    context.setCurrentUser(alice);
    users.authenticate.mockReturnValue(
      Effect.fail(new Error("Invalid credentials")),
    );

    await expect(effects.run(sessions.login("bob", "wrong"))).rejects.toThrow(
      "Invalid credentials",
    );
    expect(processes.stopSessionApps).not.toHaveBeenCalled();
    expect(sessions.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps the old identity when app shutdown fails", async () => {
    context.setCurrentUser(alice);
    users.authenticate.mockReturnValue(Effect.succeed(bob));
    processes.stopSessionApps.mockReturnValue(
      Effect.fail(new Error("shutdown failed")),
    );

    await expect(
      effects.run(sessions.login("bob", "password")),
    ).rejects.toThrow("shutdown failed");
    expect(sessions.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects concurrent transitions", async () => {
    const authentication = gate<UserProfile>();
    users.authenticate.mockReturnValue(
      fromPromise(() => authentication.promise),
    );

    const login = effects.run(sessions.login("alice", "password"));
    await expect(effects.run(sessions.logout())).rejects.toThrow(
      "A session transition is already in progress",
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
});

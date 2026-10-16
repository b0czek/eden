import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { gate } from "../../tests/support/async";
import { fromPromise } from "../effects/io";
import { createEffectRuntime, type EffectRuntime } from "../effects/runtime";
import { createExecutionContext } from "../execution/ExecutionContext";
import {
  createOperationManager,
  type OperationManager,
} from "../operations/OperationManager";
import { createSessionContext, type SessionContext } from "./SessionContext";
import { createSessionManager, type SessionManager } from "./SessionManager";

const createUser = (username: string): UserProfile => ({
  username,
  name: username,
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
});

describe("SessionManager", () => {
  const alice = createUser("alice");
  const bob = createUser("bob");
  let context: SessionContext;
  let userManager: {
    authenticate: jest.Mock;
    getDefaultUser: jest.Mock;
  };
  let processManager: { stopSessionApps: jest.Mock };
  let notify: jest.Mock;
  let manager: SessionManager;
  let operations: OperationManager;
  let effects: EffectRuntime;

  beforeEach(async () => {
    context = createSessionContext();
    userManager = {
      authenticate: jest.fn(),
      getDefaultUser: jest.fn().mockReturnValue(Effect.succeed(null)),
    };
    processManager = {
      stopSessionApps: jest.fn().mockReturnValue(Effect.void),
    };
    notify = jest.fn();
    effects = createEffectRuntime();
    operations = createOperationManager({
      effects,
      execution: createExecutionContext({ config: {} }),
      session: context,
      filesystem: { releaseHandles: () => Effect.void },
    });
    manager = await effects.acquire(
      createSessionManager({
        users: userManager,
        processes: processManager,
        context,
        operations,
      }),
    );
    manager.changed.on(notify);
  });

  afterEach(async () => {
    operations.dispose();
    await effects.dispose();
  });

  it("does not stop apps or change identity when authentication fails", async () => {
    context.setCurrentUser(alice);
    userManager.authenticate.mockReturnValue(
      Effect.fail(new Error("Invalid credentials")),
    );

    await expect(effects.run(manager.login("bob", "wrong"))).rejects.toThrow(
      "Invalid credentials",
    );
    expect(processManager.stopSessionApps).not.toHaveBeenCalled();
    expect(manager.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps the old identity when app shutdown fails", async () => {
    context.setCurrentUser(alice);
    userManager.authenticate.mockReturnValue(Effect.succeed(bob));
    processManager.stopSessionApps.mockReturnValue(
      Effect.fail(new Error("shutdown failed")),
    );

    await expect(effects.run(manager.login("bob", "password"))).rejects.toThrow(
      "shutdown failed",
    );
    expect(manager.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects concurrent transitions", async () => {
    const authentication = gate<UserProfile>();
    userManager.authenticate.mockReturnValue(
      fromPromise(() => authentication.promise),
    );

    const login = effects.run(manager.login("alice", "password"));
    await expect(effects.run(manager.logout())).rejects.toThrow(
      "A session transition is already in progress",
    );
    authentication.release(alice);
    await login;
  });

  it("refreshes the same identity without stopping apps", async () => {
    context.setCurrentUser(alice);
    const refreshed = { ...alice, name: "Alice Updated", updatedAt: 2 };
    userManager.authenticate.mockReturnValue(Effect.succeed(refreshed));

    await effects.run(manager.login("alice", "password"));

    expect(processManager.stopSessionApps).not.toHaveBeenCalled();
    expect(manager.getCurrentUser()).toEqual(refreshed);
  });

  it("activates the configured default user during initialization", async () => {
    userManager.getDefaultUser.mockReturnValue(Effect.succeed(alice));

    await effects.run(manager.initialize());

    expect(processManager.stopSessionApps).toHaveBeenCalledTimes(1);
    expect(manager.getCurrentUser()).toEqual(alice);
    expect(notify).toHaveBeenCalledWith({
      currentUser: alice,
      previousUsername: null,
      reason: "system",
    });
  });
});

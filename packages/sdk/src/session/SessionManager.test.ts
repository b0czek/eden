import "reflect-metadata";

import type { UserProfile } from "@edenapp/types";
import type { CommandRegistry, IPCBridge } from "../ipc";
import { OperationManager } from "../operations/OperationManager";
import { ExecutionContext } from "../execution/ExecutionContext";
import type { ProcessManager } from "../process-manager/ProcessManager";
import type { UserManager } from "../user/UserManager";
import { SessionContext } from "./SessionContext";
import { SessionManager } from "./SessionManager";

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

  beforeEach(() => {
    context = new SessionContext();
    userManager = {
      authenticate: jest.fn(),
      getDefaultUser: jest.fn().mockResolvedValue(null),
    };
    processManager = {
      stopSessionApps: jest.fn().mockResolvedValue(undefined),
    };
    notify = jest.fn();
    const bridge = { eventSubscribers: { notify } } as unknown as IPCBridge;
    operations = new OperationManager(
      bridge,
      new ExecutionContext({}),
      context,
    );
    manager = new SessionManager(
      { eventSubscribers: { notify } } as unknown as IPCBridge,
      { registerManager: jest.fn() } as unknown as CommandRegistry,
      userManager as unknown as UserManager,
      processManager as unknown as ProcessManager,
      context,
      operations,
    );
  });

  afterEach(() => operations.dispose());

  it("does not stop apps or change identity when authentication fails", async () => {
    context.setCurrentUser(alice);
    userManager.authenticate.mockRejectedValue(
      new Error("Invalid credentials"),
    );

    await expect(manager.login("bob", "wrong")).rejects.toThrow(
      "Invalid credentials",
    );
    expect(processManager.stopSessionApps).not.toHaveBeenCalled();
    expect(manager.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("keeps the old identity when app shutdown fails", async () => {
    context.setCurrentUser(alice);
    userManager.authenticate.mockResolvedValue(bob);
    processManager.stopSessionApps.mockRejectedValue(
      new Error("shutdown failed"),
    );

    await expect(manager.login("bob", "password")).rejects.toThrow(
      "shutdown failed",
    );
    expect(manager.getCurrentUser()?.username).toBe("alice");
    expect(notify).not.toHaveBeenCalled();
  });

  it("rejects concurrent transitions", async () => {
    let resolveAuthentication: ((user: UserProfile) => void) | undefined;
    userManager.authenticate.mockReturnValue(
      new Promise<UserProfile>((resolve) => {
        resolveAuthentication = resolve;
      }),
    );

    const login = manager.login("alice", "password");
    await expect(manager.logout()).rejects.toThrow(
      "A session transition is already in progress",
    );
    resolveAuthentication?.(alice);
    await login;
  });

  it("refreshes the same identity without stopping apps", async () => {
    context.setCurrentUser(alice);
    const refreshed = { ...alice, name: "Alice Updated", updatedAt: 2 };
    userManager.authenticate.mockResolvedValue(refreshed);

    await manager.login("alice", "password");

    expect(processManager.stopSessionApps).not.toHaveBeenCalled();
    expect(manager.getCurrentUser()).toEqual(refreshed);
  });

  it("activates the configured default user during initialization", async () => {
    userManager.getDefaultUser.mockResolvedValue(alice);

    await manager.initialize();

    expect(processManager.stopSessionApps).toHaveBeenCalledTimes(1);
    expect(manager.getCurrentUser()).toEqual(alice);
    expect(notify).toHaveBeenCalledWith("session/changed", {
      currentUser: alice,
      previousUsername: null,
      reason: "system",
    });
  });
});

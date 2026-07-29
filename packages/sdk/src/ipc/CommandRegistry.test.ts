import "reflect-metadata";

import { ExecutionContext } from "../execution";
import { addCommandHandler, setManagerNamespace } from "./CommandMetadata";
import { CommandRegistry } from "./CommandRegistry";

type PermissionRegistryLike = {
  hasPermission: jest.Mock<boolean, [string, string]>;
  getRequiredGrantKeys: jest.Mock<string[], [string, string]>;
};

type SessionContextLike = {
  getCurrentUser: jest.Mock;
};

describe("CommandRegistry", () => {
  let permissionRegistry: PermissionRegistryLike;
  let sessionContext: SessionContextLike;
  let executionContext: ExecutionContext;
  let registry: CommandRegistry;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    permissionRegistry = {
      hasPermission: jest.fn(),
      getRequiredGrantKeys: jest.fn(),
    };
    sessionContext = {
      getCurrentUser: jest.fn().mockReturnValue(null),
    };
    executionContext = new ExecutionContext({});
    registry = new CommandRegistry(
      permissionRegistry as unknown as ConstructorParameters<
        typeof CommandRegistry
      >[0],
      sessionContext as unknown as ConstructorParameters<
        typeof CommandRegistry
      >[1],
      executionContext,
    );

    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("registers and executes a command", async () => {
    const handler = jest.fn().mockResolvedValue("ok");

    registry.register("system", "ping", handler, { name: "target" });

    expect(registry.has("system/ping")).toBe(true);
    await expect(registry.execute("system/ping", { value: 1 })).resolves.toBe(
      "ok",
    );
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it("establishes the session user as the principal for interactive commands", async () => {
    const profile = {
      username: "operator",
      name: "Operator",
      role: "standard" as const,
      grants: ["preset/settings/read"],
      createdAt: 1,
      updatedAt: 1,
    };
    sessionContext.getCurrentUser.mockReturnValue(profile);
    const handler = jest.fn(() => executionContext.getPrincipal());
    registry.register("system", "whoami", handler, {});

    await expect(registry.execute("system/whoami", {})).resolves.toEqual({
      kind: "user",
      profile,
    });
  });

  it("synthesizes trusted caller arguments at handler invocation", async () => {
    const handler = jest.fn((args) => args);
    registry.register("system", "caller", handler, {});

    const result = await registry.execute(
      "system/caller",
      {
        value: 1,
        _callerAppId: "spoofed",
        _callerWebContentsId: 999,
        _isFoundation: true,
      },
      {
        appId: "app.one",
        webContentsId: 42,
        foundation: false,
        principal: {
          kind: "user",
          profile: {
            username: "user",
            name: "User",
            role: "standard",
            grants: [],
            createdAt: 1,
            updatedAt: 1,
          },
        },
      },
    );

    expect(result).toEqual({
      value: 1,
      _callerAppId: "app.one",
      _callerWebContentsId: 42,
      _isFoundation: false,
    });
  });

  it("warns when overwriting an existing handler", () => {
    const handler = jest.fn();

    registry.register("system", "ping", handler, {});
    registry.register("system", "ping", handler, {});

    expect(warnSpy).toHaveBeenCalledWith(
      'Command handler for "system/ping" is being overwritten',
    );
  });

  it("registers handlers from manager metadata", async () => {
    class TestManager {
      value = 10;

      handle(): number {
        return this.value + 5;
      }
    }

    setManagerNamespace(TestManager, "manager");
    addCommandHandler(TestManager, "add", "handle");

    const instance = new TestManager();
    registry.registerManager(instance);

    expect(registry.getNamespaceCommands("manager")).toEqual(["manager/add"]);
    await expect(registry.execute("manager/add", {})).resolves.toBe(15);
  });

  it("enforces permission checks and grant requirements", async () => {
    class SecureManager {
      handle(): string {
        return "secured";
      }
    }

    Reflect.defineMetadata(
      "eden:handler:permission",
      "read",
      SecureManager.prototype,
      "handle",
    );

    const instance = new SecureManager();
    registry.register("files", "read", instance.handle, instance, "handle");

    permissionRegistry.hasPermission.mockReturnValue(false);
    permissionRegistry.getRequiredGrantKeys.mockReturnValue([]);

    await expect(
      registry.execute("files/read", {}, { appId: "app.one" }),
    ).rejects.toThrow("Caller principal could not be resolved for app app.one");

    const caller = {
      appId: "app.one",
      principal: {
        kind: "user" as const,
        profile: {
          username: "user",
          name: "User",
          role: "standard" as const,
          grants: [] as string[],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    };

    await expect(registry.execute("files/read", {}, caller)).rejects.toThrow(
      "Permission denied: files/read required for files/read",
    );

    permissionRegistry.getRequiredGrantKeys.mockReturnValue([
      "preset/files/read",
    ]);
    await expect(registry.execute("files/read", {}, caller)).rejects.toThrow(
      "Grant denied: preset/files/read required for files/read",
    );

    caller.principal.profile.grants.push("preset/files/read");

    await expect(registry.execute("files/read", {}, caller)).resolves.toBe(
      "secured",
    );

    await expect(
      registry.execute(
        "files/read",
        {},
        {
          ...caller,
          principal: {
            ...caller.principal,
            profile: { ...caller.principal.profile, grants: [] },
          },
        },
      ),
    ).rejects.toThrow("Grant denied");
  });

  it("skips grant checks when base permission is present", async () => {
    class ManageManager {
      handle(): string {
        return "ok";
      }
    }

    Reflect.defineMetadata(
      "eden:handler:permission",
      "manage",
      ManageManager.prototype,
      "handle",
    );

    const instance = new ManageManager();
    registry.register("apps", "manage", instance.handle, instance, "handle");

    permissionRegistry.hasPermission.mockReturnValue(true);

    await expect(
      registry.execute(
        "apps/manage",
        {},
        {
          appId: "app.two",
          principal: {
            kind: "user",
            profile: {
              username: "user",
              name: "User",
              role: "standard",
              grants: [],
              createdAt: 1,
              updatedAt: 1,
            },
          },
        },
      ),
    ).resolves.toBe("ok");
    expect(permissionRegistry.getRequiredGrantKeys).not.toHaveBeenCalled();
  });

  it("throws on unknown commands", async () => {
    await expect(registry.execute("missing/command", {})).rejects.toThrow(
      "Unknown command: missing/command",
    );
  });
});

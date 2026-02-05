import "reflect-metadata";

import { CommandRegistry } from "./CommandRegistry";
import { setManagerNamespace, addCommandHandler } from "./CommandMetadata";

type PermissionRegistryLike = {
  hasPermission: jest.Mock<boolean, [string, string]>;
  getRequiredGrantKeys: jest.Mock<string[], [string, string]>;
};

type UserManagerLike = {
  hasGrant: jest.Mock<boolean, [string]>;
};

describe("CommandRegistry", () => {
  let permissionRegistry: PermissionRegistryLike;
  let userManager: UserManagerLike;
  let registry: CommandRegistry;
  let warnSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    permissionRegistry = {
      hasPermission: jest.fn(),
      getRequiredGrantKeys: jest.fn(),
    };
    userManager = {
      hasGrant: jest.fn(),
    };
    registry = new CommandRegistry(
      permissionRegistry as any,
      userManager as any,
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

    await expect(registry.execute("files/read", {}, "app.one")).rejects.toThrow(
      "Permission denied: files/read required for files/read",
    );

    permissionRegistry.getRequiredGrantKeys.mockReturnValue([
      "preset/files/read",
    ]);
    userManager.hasGrant.mockReturnValue(false);

    await expect(registry.execute("files/read", {}, "app.one")).rejects.toThrow(
      "Grant denied: preset/files/read required for files/read",
    );

    userManager.hasGrant.mockReturnValue(true);

    await expect(registry.execute("files/read", {}, "app.one")).resolves.toBe(
      "secured",
    );
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

    await expect(registry.execute("apps/manage", {}, "app.two")).resolves.toBe(
      "ok",
    );
    expect(permissionRegistry.getRequiredGrantKeys).not.toHaveBeenCalled();
  });

  it("throws on unknown commands", async () => {
    await expect(registry.execute("missing/command", {})).rejects.toThrow(
      "Unknown command: missing/command",
    );
  });
});

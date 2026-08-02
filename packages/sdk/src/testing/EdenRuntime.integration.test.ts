import "reflect-metadata";
import * as fs from "node:fs/promises";
import type { UserProfile } from "@edenapp/types";
import { DaemonManager } from "../daemon";
import { CommandRegistry, PermissionRegistry } from "../ipc";
import { PowerManager } from "../power";
import { ProcessManager } from "../process-manager";
import { SessionManager } from "../session";
import { SettingsManager } from "../settings";
import { UserManager } from "../user";
import { createTestEden, type TestEden } from "./createTestEden";

function caller(appId: string, profile: UserProfile) {
  return {
    appId,
    principal: { kind: "user" as const, profile },
  };
}

describe("EdenRuntime Node integration", () => {
  const active: TestEden[] = [];

  afterEach(async () => {
    await Promise.all(active.splice(0).map((eden) => eden.dispose()));
    jest.restoreAllMocks();
  });

  it("isolates commands, sessions, permissions, settings, and filesystem roots", async () => {
    const first = await createTestEden();
    const second = await createTestEden();
    active.push(first, second);

    const firstCommands = first.runtime.resolve(CommandRegistry);
    const secondCommands = second.runtime.resolve(CommandRegistry);
    firstCommands.register("test", "only-first", () => "first", {});
    expect(await first.execute("test/only-first")).toBe("first");
    expect(secondCommands.has("test/only-first")).toBe(false);

    const firstPermissions = first.runtime.resolve(PermissionRegistry);
    const secondPermissions = second.runtime.resolve(PermissionRegistry);
    firstPermissions.registerApp("isolated-app", ["fs/write"]);
    expect(firstPermissions.hasPermission("isolated-app", "fs/write")).toBe(
      true,
    );
    expect(secondPermissions.hasApp("isolated-app")).toBe(false);
    firstPermissions.registerEventPermission("test/changed", "test/read");
    expect(
      secondPermissions.getEventPermission("test/changed"),
    ).toBeUndefined();

    const firstUser = await first.runtime.resolve(UserManager).createUser({
      username: "first-user",
      name: "First User",
      password: "first-password",
    });
    const secondUser = await second.runtime.resolve(UserManager).createUser({
      username: "second-user",
      name: "Second User",
      password: "second-password",
    });
    await first.runtime
      .resolve(SessionManager)
      .login(firstUser.username, "first-password");
    await second.runtime
      .resolve(SessionManager)
      .login(secondUser.username, "second-password");
    expect(
      first.runtime.resolve(SessionManager).getCurrentUser()?.username,
    ).toBe("first-user");
    expect(
      second.runtime.resolve(SessionManager).getCurrentUser()?.username,
    ).toBe("second-user");

    const firstSettings = first.runtime.resolve(SettingsManager);
    const secondSettings = second.runtime.resolve(SettingsManager);
    await firstSettings.set("isolated-app", "value", "first");
    await secondSettings.set("isolated-app", "value", "second");
    expect(await firstSettings.get("isolated-app", "value")).toBe("first");
    expect(await secondSettings.get("isolated-app", "value")).toBe("second");

    await first.execute(
      "fs/write",
      { path: "/runtime.txt", content: "first-root" },
      caller("isolated-app", firstUser),
    );
    await fs.writeFile(
      `${second.paths.userDirectory}/runtime.txt`,
      "second-root",
    );
    expect(
      await fs.readFile(`${first.paths.userDirectory}/runtime.txt`, "utf8"),
    ).toBe("first-root");
    expect(
      await fs.readFile(`${second.paths.userDirectory}/runtime.txt`, "utf8"),
    ).toBe("second-root");
    expect(first.paths.root).not.toBe(second.paths.root);
  });

  it("executes authorized commands and rejects unauthorized callers through real permission handling", async () => {
    const eden = await createTestEden();
    active.push(eden);
    const profile = await eden.runtime.resolve(UserManager).createUser({
      username: "permission-user",
      name: "Permission User",
      password: "password",
    });
    const permissions = eden.runtime.resolve(PermissionRegistry);
    permissions.registerApp("authorized-app", ["fs/write", "fs/read"]);
    permissions.registerApp("unauthorized-app", ["fs/read"]);

    await eden.execute(
      "fs/write",
      { path: "/authorized.txt", content: "allowed" },
      caller("authorized-app", profile),
    );
    expect(
      await eden.execute(
        "fs/read",
        { path: "/authorized.txt" },
        caller("authorized-app", profile),
      ),
    ).toBe("allowed");
    await expect(
      eden.execute(
        "fs/write",
        { path: "/denied.txt", content: "blocked" },
        caller("unauthorized-app", profile),
      ),
    ).rejects.toThrow("Permission denied: fs/write");
    await expect(
      fs.access(`${eden.paths.userDirectory}/denied.txt`),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("coordinates a power command through the real managers before the provider", async () => {
    const order: string[] = [];
    const eden = await createTestEden({
      config: {
        powerProvider: {
          poweroff: async () => {
            order.push("provider.poweroff");
          },
        },
      },
    });
    active.push(eden);
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp("power-app", ["system/power"]);

    const daemons = eden.runtime.resolve(DaemonManager);
    const processes = eden.runtime.resolve(ProcessManager);
    const realDaemonShutdown = daemons.shutdown.bind(daemons);
    const realProcessShutdown = processes.shutdown.bind(processes);
    const daemonShutdown = jest
      .spyOn(daemons, "shutdown")
      .mockImplementation(async () => {
        order.push("daemon.shutdown");
        await realDaemonShutdown();
      });
    const processShutdown = jest
      .spyOn(processes, "shutdown")
      .mockImplementation(async () => {
        order.push("process.shutdown");
        await realProcessShutdown();
      });

    await eden.execute(
      "system/power",
      { action: "poweroff" },
      { appId: "power-app", principal: { kind: "system" } },
    );

    expect(daemonShutdown).toHaveBeenCalledTimes(1);
    expect(processShutdown).toHaveBeenCalledTimes(1);
    expect(order).toEqual([
      "daemon.shutdown",
      "process.shutdown",
      "provider.poweroff",
    ]);
    expect(eden.runtime.resolve(PowerManager).getCapabilities()).toEqual({
      poweroff: true,
      reboot: false,
    });
  });

  it("disposes partially initialized resources after startup failure", async () => {
    const eden = await createTestEden({
      autoStart: false,
      platform: { failWindowCreation: new Error("window creation failed") },
    });
    active.push(eden);

    await expect(eden.start()).rejects.toThrow("window creation failed");
    expect(eden.runtime.state).toBe("failed");
    expect(eden.platform.activeResourceCount).toBe(0);

    await eden.dispose();
    expect(eden.runtime.state).toBe("stopped");
    await expect(fs.access(eden.paths.root)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("supports disposal before startup, after success, and repeatedly", async () => {
    const beforeStart = await createTestEden({ autoStart: false });
    active.push(beforeStart);
    await beforeStart.dispose();
    await beforeStart.dispose();
    expect(beforeStart.runtime.state).toBe("stopped");
    expect(beforeStart.platform.activeResourceCount).toBe(0);

    const afterStart = await createTestEden();
    active.push(afterStart);
    expect(afterStart.runtime.state).toBe("ready");
    await afterStart.dispose();
    await afterStart.dispose();
    expect(afterStart.runtime.state).toBe("stopped");
    expect(afterStart.platform.activeResourceCount).toBe(0);
  });

  it("does not retain platform resources or temporary roots across repeated cycles", async () => {
    for (let cycle = 0; cycle < 3; cycle++) {
      const eden = await createTestEden();
      const root = eden.paths.root;
      expect(eden.platform.rendererIpc.registrationCount).toBeGreaterThan(0);
      await eden.dispose();
      expect(eden.platform.activeResourceCount).toBe(0);
      await expect(fs.access(root)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });
});

import "reflect-metadata";
import * as fs from "node:fs/promises";
import type { UserProfile } from "@edenapp/types";
import { CommandRegistry, PermissionRegistry } from "../ipc";
import { SessionManager } from "../session";
import { SettingsManager } from "../settings";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { UserManager } from "../user";

const caller = (appId: string, profile: UserProfile) => ({
  appId,
  principal: { kind: "user" as const, profile },
});

describe("EdenRuntime integration", () => {
  const active: TestEden[] = [];

  afterEach(async () => {
    await Promise.all(active.splice(0).map((eden) => eden.dispose()));
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

  it("aborts readiness when disposal starts during startup", async () => {
    const eden = await createTestEden({ autoStart: false });
    active.push(eden);

    const readiness = expect(eden.runtime.whenReady()).rejects.toThrow(
      "startup aborted by shutdown",
    );
    const startup = eden.start();
    const shutdown = eden.dispose();

    await expect(startup).rejects.toThrow("startup aborted by shutdown");
    await shutdown;
    await readiness;

    expect(eden.runtime.state).toBe("stopped");
    expect(eden.platform.activeResourceCount).toBe(0);
    expect(
      eden.platform.effects.some((effect) => effect.type === "window-created"),
    ).toBe(false);
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

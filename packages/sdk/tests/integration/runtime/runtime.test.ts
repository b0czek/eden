import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { UserProfile } from "@edenapp/types";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import { command, defineController } from "../../../src/controllers/controller";
import * as packageService from "../../../src/packages/service";
import { hashPassword } from "../../../src/user/auth";
import { gate } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/createTestEden";

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

    const firstCommands = first.runtime.services.commands;
    const secondCommands = second.runtime.services.commands;
    firstCommands.registerController(
      defineController("test", {
        commands: { "only-first": command({ handle: () => "first" }) },
      }),
    );
    expect(await first.execute("test/only-first")).toBe("first");
    expect(secondCommands.has("test/only-first")).toBe(false);

    const firstPermissions = first.runtime.services.permissions;
    const secondPermissions = second.runtime.services.permissions;
    firstPermissions.registerApp("isolated-app", ["fs/write"]);
    expect(firstPermissions.hasPermission("isolated-app", "fs/write")).toBe(
      true,
    );
    expect(secondPermissions.hasApp("isolated-app")).toBe(false);
    firstPermissions.registerEventPermission("test/changed", "test/read");
    expect(
      secondPermissions.getEventPermission("test/changed"),
    ).toBeUndefined();

    const firstUser = await first.runtime.effects.run(
      first.runtime.services.users.createUser({
        username: "first-user",
        name: "First User",
        password: "first-password",
      }),
    );
    const secondUser = await second.runtime.effects.run(
      second.runtime.services.users.createUser({
        username: "second-user",
        name: "Second User",
        password: "second-password",
      }),
    );
    await first.runtime.effects.run(
      first.runtime.services.sessions.login(
        firstUser.username,
        "first-password",
      ),
    );
    await second.runtime.effects.run(
      second.runtime.services.sessions.login(
        secondUser.username,
        "second-password",
      ),
    );
    expect(first.runtime.services.sessions.getCurrentUser()?.username).toBe(
      "first-user",
    );
    expect(second.runtime.services.sessions.getCurrentUser()?.username).toBe(
      "second-user",
    );

    const firstSettings = first.runtime.services.settings;
    const secondSettings = second.runtime.services.settings;
    await first.runtime.effects.run(
      firstSettings.set("isolated-app", "value", "first"),
    );
    await second.runtime.effects.run(
      secondSettings.set("isolated-app", "value", "second"),
    );
    expect(
      await first.runtime.effects.run(
        firstSettings.get("isolated-app", "value"),
      ),
    ).toBe("first");
    expect(
      await second.runtime.effects.run(
        secondSettings.get("isolated-app", "value"),
      ),
    ).toBe("second");

    await first.runtime.effects.run(
      firstSettings.set("com.eden", "general.locale", "pl"),
    );
    await second.runtime.effects.run(
      secondSettings.set("com.eden", "general.locale", "en"),
    );
    expect(await first.execute("i18n/get-locale")).toEqual({ locale: "pl" });
    expect(await second.execute("i18n/get-locale")).toEqual({ locale: "en" });

    await first.runtime.effects.run(
      first.runtime.appearance.setWallpaper({
        type: "custom",
        value: "#112233",
      }),
    );
    await second.runtime.effects.run(
      second.runtime.appearance.setWallpaper({
        type: "custom",
        value: "#445566",
      }),
    );
    expect(
      await first.runtime.effects.run(first.runtime.appearance.getWallpaper()),
    ).toMatchObject({
      value: "#112233",
    });
    expect(
      await second.runtime.effects.run(
        second.runtime.appearance.getWallpaper(),
      ),
    ).toMatchObject({
      value: "#445566",
    });

    await first.execute(
      "fs/write",
      {
        location: { path: "/runtime.txt", volume: "home" },
        content: "first-root",
      },
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

  it("rolls back acquired resources when composition fails before a service bundle exists", async () => {
    const failure = new Error("keyboard handler unavailable");
    const eden = await createTestEden({ autoStart: false });
    active.push(eden);
    const ipc = eden.platform.rendererIpc;
    const handle = ipc.handle.bind(ipc);
    let reachedKeyboard = false;
    ipc.handle = (channel, listener) => {
      if (channel.includes("keyboard")) {
        reachedKeyboard = true;
        throw failure;
      }
      return handle(channel, listener);
    };
    const readiness = expect(eden.runtime.whenReady()).rejects.toBe(failure);
    await expect(eden.start()).rejects.toBe(failure);
    await readiness;
    expect(reachedKeyboard).toBe(true);
    expect(eden.runtime.state).toBe("failed");
    expect(eden.platform.activeResourceCount).toBe(0);
    expect(() => eden.runtime.services).toThrow("unavailable");
    await expect(eden.runtime.effects.run(Effect.void)).rejects.toThrow(
      "disposed",
    );
  });

  it("preserves the startup failure and finishes disposal when a scoped finalizer fails", async () => {
    const startupFailure = new Error("foundation window unavailable");
    const eden = await createTestEden({
      autoStart: false,
      platform: { failWindowCreation: startupFailure },
    });
    active.push(eden);
    const createPackages = packageService.createPackages;
    const acquisition = jest
      .spyOn(packageService, "createPackages")
      .mockImplementation((dependencies) =>
        Effect.gen(function* () {
          const packages = yield* createPackages(dependencies);
          yield* Effect.addFinalizer(() =>
            Effect.die(new Error("resource close failed")),
          );
          return packages;
        }),
      );
    const windows = eden.platform.windows;
    const createWindow = windows.createWindow.bind(windows);
    windows.createWindow = (options) => {
      const { commands, permissions } = eden.runtime.services;
      commands.registerController(
        defineController("cleanup", {
          commands: { transient: command({ handle: () => "active" }) },
        }),
      );
      permissions.registerApp("cleanup-owner", ["package/read"]);

      return createWindow(options);
    };

    const readiness = eden.runtime.whenReady();
    try {
      await expect(eden.start()).rejects.toBe(startupFailure);
      await expect(readiness).rejects.toBe(startupFailure);
    } finally {
      acquisition.mockRestore();
    }

    expect(eden.runtime.state).toBe("failed");
    expect(eden.platform.activeResourceCount).toBe(0);
    const { commands, permissions } = eden.runtime.services;
    expect(commands.has("cleanup/transient")).toBe(false);
    expect(permissions.hasApp("cleanup-owner")).toBe(false);
    await expect(eden.runtime.effects.run(Effect.void)).rejects.toThrow(
      "disposed",
    );
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
    await expect(afterStart.start()).rejects.toThrow(
      "Cannot start Eden runtime from stopped state",
    );
  });

  it("releases pre-start settings registrations without constructing services", async () => {
    const eden = await createTestEden({ autoStart: false });
    active.push(eden);
    const definition = {
      id: "host.before-start",
      title: { en: "Before startup" },
    };
    const provider = { load: () => Effect.sync(() => ({ sections: [] })) };
    const registration = eden.runtime.settings.registerPanel(
      definition,
      provider,
    );
    registration.setVisible(false);
    await eden.dispose();
    expect(eden.platform.activeResourceCount).toBe(0);
    expect(() => registration.invalidate()).toThrow(/stale|unregistered/);
    expect(() =>
      eden.runtime.settings.registerPanel(definition, provider),
    ).toThrow("closed");
  });

  it("interrupts blocked service initialization and releases the graph without running later startup", async () => {
    const entered = gate();
    const proceed = Deferred.makeUnsafe<void>();
    let interrupted = false;
    const createPackages = packageService.createPackages;
    const factory = jest
      .spyOn(packageService, "createPackages")
      .mockImplementation((dependencies) =>
        Effect.map(createPackages(dependencies), (packages) => ({
          ...packages,
          initialize: () =>
            Effect.gen(function* () {
              entered.release();
              yield* Deferred.await(proceed);
              yield* packages.initialize();
            }).pipe(
              Effect.onInterrupt(() =>
                Effect.sync(() => {
                  interrupted = true;
                }),
              ),
            ),
        })),
      );
    const eden = await createTestEden({ autoStart: false });
    active.push(eden);
    const starting = eden.start();
    const rejected = expect(starting).rejects.toThrow(
      "startup aborted by shutdown",
    );
    let shutdown: Promise<void> | undefined;
    try {
      await entered.promise;
      shutdown = eden.runtime.dispose();
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(interrupted).toBe(true);
      await shutdown;
      await rejected;
      expect(eden.runtime.state).toBe("stopped");
      expect(eden.platform.activeResourceCount).toBe(0);
      expect(
        eden.platform.effects.some(
          (effect) => effect.type === "window-created",
        ),
      ).toBe(false);
    } finally {
      Deferred.doneUnsafe(proceed, Effect.void);
      factory.mockRestore();
      await Promise.allSettled([starting, shutdown ?? eden.runtime.dispose()]);
    }
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
  it("aborts readiness when shutdown starts while attaching the keyboard to the foundation window", async () => {
    const eden = await createTestEden({ autoStart: false });
    active.push(eden);
    const windows = eden.platform.windows;
    const createWindow = windows.createWindow.bind(windows);
    windows.createWindow = (options) => {
      const window = createWindow(options);
      void eden.dispose();
      return window;
    };
    const readiness = expect(eden.runtime.whenReady()).rejects.toThrow(
      "startup aborted by shutdown",
    );
    await expect(eden.start()).rejects.toThrow("startup aborted by shutdown");
    await eden.dispose();
    await readiness;
    expect(eden.runtime.state).toBe("stopped");
    expect(eden.platform.activeResourceCount).toBe(0);
  });

  it("preserves changed credentials, default account, settings, and wallpaper when restarting the same seeded profile", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-restart-"));
    try {
      const seedPath = path.join(root, "eden-seed.json");
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          users: [
            {
              username: "vendor",
              name: "Vendor",
              role: "vendor",
              ...(await Effect.runPromise(hashPassword("seed-password"))),
            },
          ],
          defaultUsername: "vendor",
          settings: { "restart-app": { theme: "seed-theme" } },
        }),
      );
      const first = await createTestEden({ root, config: { seedPath } });
      active.push(first);
      const users = first.runtime.services.users;
      expect(users.getDefaultUsername()).toBe("vendor");
      await expect(
        first.runtime.effects.run(
          users.authenticate("vendor", "seed-password"),
        ),
      ).resolves.toMatchObject({ username: "vendor" });
      expect(
        await first.runtime.effects.run(
          first.runtime.services.settings.get("restart-app", "theme"),
        ),
      ).toBe("seed-theme");
      await first.runtime.effects.run(
        users.setPassword("vendor", "changed-password"),
      );
      const operator = await first.runtime.effects.run(
        users.createUser({
          username: "operator",
          name: "Operator",
          password: "operator-password",
        }),
      );
      await first.runtime.effects.run(
        users.setDefaultUsername(operator.username),
      );
      await first.runtime.effects.run(
        first.runtime.services.settings.set(
          "restart-app",
          "theme",
          "changed-theme",
        ),
      );
      await first.runtime.effects.run(
        first.runtime.appearance.setWallpaper({
          type: "custom",
          value: "#abcdef",
        }),
      );
      await first.dispose();

      const second = await createTestEden({ root, config: { seedPath } });
      active.push(second);
      const restored = second.runtime.services.users;
      await expect(
        second.runtime.effects.run(
          restored.authenticate("vendor", "changed-password"),
        ),
      ).resolves.toMatchObject({ username: "vendor" });
      await expect(
        second.runtime.effects.run(
          restored.authenticate("vendor", "seed-password"),
        ),
      ).rejects.toThrow("Invalid credentials");
      await expect(
        second.runtime.effects.run(
          restored.authenticate("operator", "operator-password"),
        ),
      ).resolves.toEqual(operator);
      expect(restored.getDefaultUsername()).toBe("operator");
      expect(second.runtime.services.sessions.getCurrentUser()?.username).toBe(
        "operator",
      );
      expect(
        await second.runtime.effects.run(
          second.runtime.services.settings.get("restart-app", "theme"),
        ),
      ).toBe("changed-theme");
      expect(
        await second.runtime.effects.run(
          second.runtime.appearance.getWallpaper(),
        ),
      ).toMatchObject({
        type: "custom",
        value: "#abcdef",
      });
    } finally {
      await Promise.all(active.splice(0).map((eden) => eden.dispose()));
      await fs.rm(root, { recursive: true, force: true });
    }
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

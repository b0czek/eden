import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { PermissionRegistry } from "../ipc";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { ProcessManager } from "./ProcessManager";

const caller = (appId: string, profile: UserProfile) => ({
  appId,
  principal: { kind: "user" as const, profile },
});

describe("ProcessManager integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("enforces process ownership through the real command path", async () => {
    eden = await createTestEden();
    const target = {
      kind: "app",
      id: "com.example.target",
      name: "Target App",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    eden.runtime.resolve(PackageRegistry).register(target);
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp("com.example.controller", ["process/manage"]);
    const alice = await eden.runtime.users.create({
      username: "alice",
      name: "Alice",
      password: "password",
      grants: [`apps/launch/${target.id}`],
    });
    const bob = await eden.runtime.users.create({
      username: "bob",
      name: "Bob",
      password: "password",
    });
    await eden.runtime.sessions.login(alice.username, "password");

    await eden.execute(
      "process/launch",
      { appId: target.id },
      caller("com.example.controller", alice),
    );
    await expect(
      eden.execute(
        "process/stop",
        { appId: target.id },
        caller("com.example.controller", bob),
      ),
    ).rejects.toThrow(`User cannot stop process ${target.id}`);
    expect(
      eden.runtime.resolve(ProcessManager).getAppInstance(target.id),
    ).toBeDefined();

    await expect(
      eden.execute(
        "process/stop",
        { appId: target.id },
        caller("com.example.controller", alice),
      ),
    ).resolves.toEqual({ success: true });
    expect(
      eden.runtime.resolve(ProcessManager).getAppInstance(target.id),
    ).toBeUndefined();
  });

  it("drains hot-reload watcher setup during shutdown", async () => {
    const stateRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-hot-reload-test-"),
    );
    const stateDirectory = path.join(stateRoot, "state");
    try {
      eden = await createTestEden({
        autoStart: false,
        config: { hotReload: { enabled: true, stateDirectory } },
      });
      const processes = eden.runtime.resolve(ProcessManager) as unknown as {
        hotReloadSetupPromise?: Promise<void>;
        hotReloadWatcher?: unknown;
      };
      const setup = processes.hotReloadSetupPromise;

      await eden.runtime.dispose();
      await setup;

      expect(processes.hotReloadWatcher).toBeUndefined();
      await expect(fs.access(stateDirectory)).resolves.toBeUndefined();
    } finally {
      await fs.rm(stateRoot, { recursive: true, force: true });
    }
  });
});

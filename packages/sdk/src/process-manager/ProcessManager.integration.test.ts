import "reflect-metadata";
import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import { AppRegistry } from "../app-registry/AppRegistry";
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
    eden.runtime.resolve(AppRegistry).register(target);
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
});

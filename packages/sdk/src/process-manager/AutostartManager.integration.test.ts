import "reflect-metadata";
import type { RuntimeAppManifest } from "@edenapp/types";
import { AppRegistry } from "../app-registry/AppRegistry";
import { SettingsManager } from "../settings";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { AutostartManager } from "./AutostartManager";
import { ProcessManager } from "./ProcessManager";

describe("AutostartManager integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("launches an enabled app after a real session transition", async () => {
    eden = await createTestEden();
    const app = {
      id: "com.example.autostart",
      name: "Autostart App",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    eden.runtime.resolve(AppRegistry).register(app);
    await eden.runtime
      .resolve(SettingsManager)
      .set("com.eden", `autostart.${app.id}`, "true");
    const user = await eden.runtime.users.create({
      username: "autostart-user",
      name: "Autostart User",
      password: "password",
      grants: [`apps/launch/${app.id}`],
    });
    const processes = eden.runtime.resolve(ProcessManager);
    const launched = new Promise<string>((resolve) => {
      const off = processes.on("launched", ({ instance }) => {
        off();
        resolve(instance.manifest.id);
      });
    });

    await eden.runtime.sessions.login(user.username, "password");

    await expect(launched).resolves.toBe(app.id);
    expect(processes.getAppInstance(app.id)).toMatchObject({
      principal: { kind: "user", username: user.username },
    });
  });

  it("cancels and drains a queued launch before process shutdown", async () => {
    eden = await createTestEden();
    const app = {
      id: "com.example.delayed-autostart",
      name: "Delayed Autostart App",
      version: "1.0.0",
      frontend: { entry: "index.html" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest;
    eden.runtime.resolve(AppRegistry).register(app);
    const settings = eden.runtime.resolve(SettingsManager);
    await settings.set("com.eden", `autostart.${app.id}`, "true");
    const user = await eden.runtime.users.create({
      username: "delayed-autostart-user",
      name: "Delayed Autostart User",
      password: "password",
      grants: [`apps/launch/${app.id}`],
    });

    let releaseSettings!: (keys: string[]) => void;
    const settingsPending = new Promise<string[]>((resolve) => {
      releaseSettings = resolve;
    });
    const listStarted = new Promise<void>((resolve) => {
      jest.spyOn(settings, "list").mockImplementationOnce(async () => {
        resolve();
        return settingsPending;
      });
    });

    await eden.runtime.sessions.login(user.username, "password");
    await listStarted;

    const autostart = eden.runtime.resolve(AutostartManager);
    let disposalSettled = false;
    const disposal = autostart.dispose().then(() => {
      disposalSettled = true;
    });
    await Promise.resolve();
    expect(disposalSettled).toBe(false);

    releaseSettings([`autostart.${app.id}`]);
    await disposal;

    expect(eden.runtime.resolve(ProcessManager).getAppInstance(app.id)).toBe(
      undefined,
    );
  });
});

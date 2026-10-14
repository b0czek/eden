import { gate } from "../../support/async";
import { testApp } from "../../support/apps";
import "reflect-metadata";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { SettingsManager } from "../../../src/settings";
import { createTestEden, type TestEden } from "../../support/createTestEden";
import { AutostartManager } from "../../../src/process-manager/AutostartManager";
import { ProcessManager } from "../../../src/process-manager/ProcessManager";

describe("AutostartManager integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("launches an enabled app after a real session transition", async () => {
    eden = await createTestEden();
    const app = testApp("com.example.autostart", { name: "Autostart App" });
    eden.runtime.resolve(PackageRegistry).register(app);
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
    const app = testApp("com.example.delayed-autostart", {
      name: "Delayed Autostart App",
    });
    eden.runtime.resolve(PackageRegistry).register(app);
    const settings = eden.runtime.resolve(SettingsManager);
    await settings.set("com.eden", `autostart.${app.id}`, "true");
    const user = await eden.runtime.users.create({
      username: "delayed-autostart-user",
      name: "Delayed Autostart User",
      password: "password",
      grants: [`apps/launch/${app.id}`],
    });

    const settingsPending = gate<string[]>();
    const listStarted = gate();
    jest.spyOn(settings, "list").mockImplementationOnce(async () => {
      listStarted.release();
      return settingsPending.promise;
    });

    await eden.runtime.sessions.login(user.username, "password");
    await listStarted.promise;

    const autostart = eden.runtime.resolve(AutostartManager);
    let disposalSettled = false;
    const disposal = autostart.dispose().then(() => {
      disposalSettled = true;
    });
    await Promise.resolve();
    expect(disposalSettled).toBe(false);

    settingsPending.release([`autostart.${app.id}`]);
    await disposal;

    expect(eden.runtime.resolve(ProcessManager).getAppInstance(app.id)).toBe(
      undefined,
    );
  });
});

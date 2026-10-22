import type { Processes } from "../../../src/applications/processes/service";
import { testApp } from "../../support/apps";
import { tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

async function readyBackend(eden: TestEden, appId: string) {
  await tick();
  const process = eden.getBackendProcess(appId);
  process.emit("message", { type: "backend-ready" });
}

describe("session process lifecycle", () => {
  let eden: TestEden;
  let processes: Processes;
  beforeEach(async () => {
    eden = await createTestEden();
    await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "operator",
        name: "Operator",
        password: "password",
        grants: ["*"],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login("operator", "password"),
    );
    processes = eden.runtime.services.processes;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await eden?.dispose();
  });

  it("launches backend-only apps as ordinary session processes", async () => {
    const appId = "app.backend";
    eden.runtime.services.installedPackages.register(
      testApp(appId, {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    const launching = eden.complete("process/launch", { appId });
    await readyBackend(eden, appId);
    await launching;
    expect(processes.getAppInstance(appId)).toMatchObject({
      owner: {
        kind: "session",
        sessionId: eden.runtime.services.sessionContext.getSessionId(),
        username: "operator",
      },
      principal: { kind: "user", username: "operator" },
      viewId: -1,
    });
    await eden.runtime.effects.run(processes.stopSessionApps());
    expect(processes.getAppInstance(appId)).toBeUndefined();
    expect(eden.runtime.services.backends.hasBackend(appId)).toBe(false);
  });

  it("stops the other apps and reports aggregate failure when one native close fails", async () => {
    for (const appId of ["app.one", "app.two", "app.three"]) {
      eden.runtime.services.installedPackages.register(testApp(appId));
      await eden.complete("process/launch", { appId });
    }
    const failed = processes.getAppInstance("app.two");
    if (!failed) throw new Error("Test app did not launch");
    const view = eden.runtime.services.views.getViewInfo(failed.viewId);
    if (!view) throw new Error("Test view did not launch");
    jest.spyOn(view.view.webContents, "close").mockImplementationOnce(() => {
      throw new Error("Native close failed");
    });
    await expect(
      eden.runtime.effects.run(processes.stopSessionApps()),
    ).rejects.toThrow("Failed to stop all session apps");
    expect(processes.getAppInstance("app.one")).toBeUndefined();
    expect(processes.getAppInstance("app.three")).toBeUndefined();
    expect(processes.getAppInstance("app.two")).toBeUndefined();
    expect(view.view.webContents.isDestroyed()).toBe(true);
  });

  it("leaves system-owned daemons running", async () => {
    eden.runtime.services.installedPackages.register(testApp("app.session"));
    await eden.complete("process/launch", { appId: "app.session" });
    eden.runtime.services.installedPackages.register(
      testApp("app.daemon", {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    const launching = eden.runtime.effects.run(
      processes.launchDaemon("app.daemon", { kind: "system" }),
    );
    await readyBackend(eden, "app.daemon");
    await launching;
    await eden.runtime.effects.run(processes.stopSessionApps());
    expect(processes.getAppInstance("app.session")).toBeUndefined();
    expect(processes.getAppInstance("app.daemon")).toMatchObject({
      owner: { kind: "system" },
      principal: { kind: "system" },
    });
    expect(eden.runtime.services.backends.hasBackend("app.daemon")).toBe(true);
  });

  it("preserves session identity when reloading outside a user context", async () => {
    const appId = "app.hot-reload";
    eden.runtime.services.installedPackages.register(testApp(appId));
    await eden.complete("process/launch", { appId });
    const before = processes.getAppInstance(appId);
    if (!before) throw new Error("Test app did not launch");
    await eden.runtime.effects.run(processes.reloadApp(appId));
    const after = processes.getAppInstance(appId);
    expect(after?.instanceId).not.toBe(before.instanceId);
    expect(after).toMatchObject({
      owner: before.owner,
      principal: before.principal,
    });
    await eden.runtime.effects.run(processes.stopSessionApps());
    expect(processes.getAppInstance(appId)).toBeUndefined();
  });
});

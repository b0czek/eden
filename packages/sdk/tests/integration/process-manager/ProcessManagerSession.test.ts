import "reflect-metadata";
import { PackageRegistry } from "../../../src/package-manager/PackageRegistry";
import { BackendManager } from "../../../src/process-manager/BackendManager";
import { ProcessManager } from "../../../src/process-manager/ProcessManager";
import { SessionContext } from "../../../src/session/SessionContext";
import { ViewManager } from "../../../src/view-manager/ViewManager";
import { testApp } from "../../support/apps";
import { tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/createTestEden";

async function readyBackend(eden: TestEden, appId: string) {
  await tick();
  const backend = eden.runtime.resolve(BackendManager).getBackend(appId);
  const process = backend?.pid
    ? eden.platform.utilityProcesses.get(backend.pid)
    : undefined;
  if (!process) throw new Error("Backend process did not start");
  process.emit("message", { type: "backend-ready" });
}

describe("session process lifecycle", () => {
  let eden: TestEden;
  let processes: ProcessManager;
  beforeEach(async () => {
    eden = await createTestEden();
    await eden.runtime.users.create({
      username: "operator",
      name: "Operator",
      password: "password",
      grants: ["*"],
    });
    await eden.runtime.sessions.login("operator", "password");
    processes = eden.runtime.resolve(ProcessManager);
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await eden?.dispose();
  });

  it("launches backend-only apps as ordinary session processes", async () => {
    const appId = "app.backend";
    eden.runtime.resolve(PackageRegistry).register(
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
        sessionId: eden.runtime.resolve(SessionContext).getSessionId(),
        username: "operator",
      },
      principal: { kind: "user", username: "operator" },
      viewId: -1,
    });
    await processes.stopSessionApps();
    expect(processes.getAppInstance(appId)).toBeUndefined();
    expect(eden.runtime.resolve(BackendManager).hasBackend(appId)).toBe(false);
  });

  it("stops the other apps and reports aggregate failure when one native close fails", async () => {
    for (const appId of ["app.one", "app.two", "app.three"]) {
      eden.runtime.resolve(PackageRegistry).register(testApp(appId));
      await eden.complete("process/launch", { appId });
    }
    const failed = processes.getAppInstance("app.two");
    if (!failed) throw new Error("Test app did not launch");
    const view = eden.runtime.resolve(ViewManager).getViewInfo(failed.viewId);
    if (!view) throw new Error("Test view did not launch");
    jest.spyOn(view.view.webContents, "close").mockImplementationOnce(() => {
      throw new Error("Native close failed");
    });
    await expect(processes.stopSessionApps()).rejects.toThrow(
      "Failed to stop all session apps",
    );
    expect(processes.getAppInstance("app.one")).toBeUndefined();
    expect(processes.getAppInstance("app.three")).toBeUndefined();
    expect(processes.getAppInstance("app.two")).toBeDefined();
  });

  it("leaves system-owned daemons running", async () => {
    eden.runtime.resolve(PackageRegistry).register(testApp("app.session"));
    await eden.complete("process/launch", { appId: "app.session" });
    eden.runtime.resolve(PackageRegistry).register(
      testApp("app.daemon", {
        frontend: undefined,
        backend: { entry: "backend.js" },
      }),
    );
    const launching = processes.launchDaemon("app.daemon", { kind: "system" });
    await readyBackend(eden, "app.daemon");
    await launching;
    await processes.stopSessionApps();
    expect(processes.getAppInstance("app.session")).toBeUndefined();
    expect(processes.getAppInstance("app.daemon")).toMatchObject({
      owner: { kind: "system" },
      principal: { kind: "system" },
    });
    expect(eden.runtime.resolve(BackendManager).hasBackend("app.daemon")).toBe(
      true,
    );
  });

  it("preserves session identity when reloading outside a user context", async () => {
    const appId = "app.hot-reload";
    eden.runtime.resolve(PackageRegistry).register(testApp(appId));
    await eden.complete("process/launch", { appId });
    const before = processes.getAppInstance(appId);
    if (!before) throw new Error("Test app did not launch");
    await processes.reloadApp(appId);
    const after = processes.getAppInstance(appId);
    expect(after?.instanceId).not.toBe(before.instanceId);
    expect(after).toMatchObject({
      owner: before.owner,
      principal: before.principal,
    });
    await processes.stopSessionApps();
    expect(processes.getAppInstance(appId)).toBeUndefined();
  });
});

import "reflect-metadata";
import type { OperationHandle, RuntimeAppManifest } from "@edenapp/types";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { OperationManager } from "../operations/OperationManager";
import { ProcessManager } from "../process-manager/ProcessManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("daemon operation lifecycle", () => {
  let eden: TestEden;
  afterEach(async () => {
    await eden.dispose();
  });

  it("retains start, restart, and stop completion across real daemon and process managers", async () => {
    eden = await createTestEden();
    const appId = "com.example.operation-daemon";
    eden.runtime
      .resolve(PackageRegistry)
      .register({
        kind: "app",
        id: appId,
        name: "Operation daemon",
        version: "1.0.0",
        backend: { entry: "backend.js" },
        isPrebuilt: false,
        isDevelopment: false,
        isCore: false,
        isRestricted: false,
        resolvedGrants: [],
      } as RuntimeAppManifest);
    const profile = await eden.runtime.users.create({
      username: "daemon",
      name: "Daemon",
      password: "password",
    });
    await eden.runtime.daemons.updateDefinition({
      appId,
      enabled: false,
      runAs: { kind: "user", username: profile.username },
      restart: "never",
    });
    const manager = eden.runtime.resolve(OperationManager);
    const ready = async (previousPid = 0) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const effect = eden.platform.effects
          .filter((item) => item.type === "utility-process-started")
          .at(-1);
        if (
          effect?.type === "utility-process-started" &&
          effect.pid !== previousPid
        ) {
          eden.platform.utilityProcesses
            .get(effect.pid)!
            .emit("message", { type: "backend-ready" });
          return effect.pid;
        }
        await tick();
      }
      throw new Error("Daemon backend did not start");
    };
    const start = await eden.execute<OperationHandle>("daemon/start", {
      appId,
    });
    expect(manager.get(start).status).toBe("queued");
    const pid = await ready();
    await expect(manager.wait(start)).resolves.toEqual({ success: true });
    expect((await eden.runtime.daemons.list())[0].state).toBe("active");
    const restart = await eden.execute<OperationHandle>("daemon/restart", {
      appId,
    });
    expect(await ready(pid)).not.toBe(pid);
    await expect(manager.wait(restart)).resolves.toEqual({ success: true });
    const stop = await eden.execute<OperationHandle>("daemon/stop", { appId });
    await expect(manager.wait(stop)).resolves.toEqual({ success: true });
    expect(
      eden.runtime.resolve(ProcessManager).getAppInstance(appId),
    ).toBeUndefined();
    expect(manager.get(stop)).toMatchObject({
      status: "succeeded",
      phase: "stopping-daemon",
    });
  });
});

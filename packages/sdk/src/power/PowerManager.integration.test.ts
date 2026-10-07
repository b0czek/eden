import "reflect-metadata";
import type { OperationHandle } from "@edenapp/types";
import { OperationManager } from "../operations/OperationManager";
import { operationTask } from "../operations/OperationTask";
import { DaemonManager } from "../daemon";
import { PermissionRegistry } from "../ipc";
import { ProcessManager } from "../process-manager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { PowerManager } from "./PowerManager";

describe("PowerManager integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    jest.restoreAllMocks();
    await eden?.dispose();
  });

  it("accepts power before draining, reports handoff, and retains failures for retry", async () => {
    let handoffs = 0;
    eden = await createTestEden({
      config: {
        powerProvider: {
          poweroff: async () => {
            handoffs++;
            if (handoffs === 1) throw new Error("Host refused poweroff");
          },
        },
      },
    });
    const manager = eden.runtime.resolve(OperationManager);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = manager.submit("integration/power-work", {}, {}, () =>
      operationTask(async () => {
        await blocked;
      }),
    );
    const handle = await eden.execute<OperationHandle>("system/power", {
      action: "poweroff",
    });
    expect(manager.get(handle).status).toBe("queued");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(handoffs).toBe(0);
    expect(manager.get(handle).status).toBe("running");
    release();
    await manager.wait(work);
    await expect(manager.wait(handle)).rejects.toThrow("Host refused poweroff");
    expect(manager.get(handle)).toMatchObject({
      status: "failed",
      phase: "host-handoff",
    });
    const retry = await eden.execute<OperationHandle>("system/power", {
      action: "poweroff",
    });
    await expect(manager.wait(retry)).resolves.toBeUndefined();
    expect(manager.get(retry)).toMatchObject({
      status: "succeeded",
      phase: "host-handoff",
    });
    expect(handoffs).toBe(2);
  });

  it("coordinates real managers before invoking the power provider", async () => {
    const order: string[] = [];
    eden = await createTestEden({
      config: {
        powerProvider: {
          poweroff: async () => {
            order.push("provider.poweroff");
          },
        },
      },
    });
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

    await eden.complete(
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
});

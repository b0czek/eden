import "reflect-metadata";
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

    await eden.execute(
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

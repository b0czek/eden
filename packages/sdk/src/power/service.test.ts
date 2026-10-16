import * as Effect from "effect/Effect";
import { createEffectRuntime } from "../effects/runtime";
import { createPowerHost } from "./adapters";
import { createPowerController } from "./controller-edenapi";
import { createPower } from "./service";

it("rejects unavailable operations synchronously before a retained task is created", async () => {
  const runtime = createEffectRuntime();
  try {
    const power = await runtime.acquire(
      createPower({
        daemons: { shutdown: () => Effect.void },
        processes: { shutdown: () => Effect.void },
      }),
    );
    const controller = createPowerController(power);
    expect(power.getCapabilities()).toEqual({ poweroff: false, reboot: false });
    expect(() =>
      controller.commands.power.execute({ action: "poweroff" }, {}),
    ).toThrow("System power management is unavailable");
  } finally {
    await runtime.dispose();
  }
});

it("drains an accepted host handoff before scope teardown and preserves provider method binding", async () => {
  const runtime = createEffectRuntime();
  let daemonStopped = false;
  let processesStopped = false;
  let accepted!: () => void;
  const started = new Promise<void>((resolve) => {
    accepted = resolve;
  });
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const provider = {
    completed: false,
    async poweroff() {
      expect(daemonStopped).toBe(true);
      expect(processesStopped).toBe(true);
      accepted();
      await pending;
      this.completed = true;
    },
  };
  try {
    const power = await runtime.acquire(
      createPower({
        host: createPowerHost(provider),
        daemons: {
          shutdown: () =>
            Effect.sync(() => {
              daemonStopped = true;
            }),
        },
        processes: {
          shutdown: () =>
            Effect.sync(() => {
              expect(daemonStopped).toBe(true);
              processesStopped = true;
            }),
        },
      }),
    );
    expect(power.getCapabilities()).toEqual({ poweroff: true, reboot: false });
    expect(() => power.assertAvailable({ action: "reboot" })).toThrow(
      "System reboot is unavailable",
    );
    const action = runtime.run(power.power({ action: "poweroff" }));
    await started;
    expect(() => power.assertAvailable({ action: "poweroff" })).toThrow(
      "already pending",
    );
    const disposal = runtime.dispose();
    let disposed = false;
    void disposal.then(() => {
      disposed = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(provider.completed).toBe(false);
    expect(disposed).toBe(false);
    finish();
    const settled = await Promise.allSettled([action, disposal]);
    expect(settled[1].status).toBe("fulfilled");
    expect(provider.completed).toBe(true);
    expect(() => power.assertAvailable({ action: "poweroff" })).toThrow(
      "disposed",
    );
  } finally {
    finish();
    await runtime.dispose();
  }
});

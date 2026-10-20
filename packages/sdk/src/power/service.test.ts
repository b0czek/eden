import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  buildService,
  createEffectRuntime,
} from "../../tests/support/effect-runtime";
import { Daemons } from "../daemon/service";
import { Processes } from "../processes/service";
import { createPowerHost } from "./adapters";
import { createPowerController } from "./controller-edenapi";
import { PowerDisposed, PowerPending, PowerUnavailable } from "./errors";
import { PowerHost } from "./ports";
import { Power, PowerLive } from "./service";

function dependency<T>(methods: Partial<T>): T {
  return new Proxy(methods as T & object, {
    get(target, key, receiver) {
      if (!(key in target))
        throw new Error(`Unexpected dependency access: ${String(key)}`);
      return Reflect.get(target, key, receiver);
    },
  });
}

it("rejects unavailable operations synchronously before a retained task is created", async () => {
  const runtime = createEffectRuntime();
  try {
    const power = await runtime.acquire(
      buildService(Power, PowerLive).pipe(
        Effect.provideService(PowerHost, undefined),
        Effect.provideService(
          Daemons,
          dependency<Daemons>({ shutdown: () => Effect.void }),
        ),
        Effect.provideService(
          Processes,
          dependency<Processes>({ shutdown: () => Effect.void }),
        ),
      ),
    );
    const controller = createPowerController(power);
    expect(power.getCapabilities()).toEqual({ poweroff: false, reboot: false });
    expect(() =>
      controller.commands.power.execute({ action: "poweroff" }, {}),
    ).toThrow(PowerUnavailable);
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
    poweroff() {
      return Effect.promise(async () => {
        expect(daemonStopped).toBe(true);
        expect(processesStopped).toBe(true);
        accepted();
        await pending;
        this.completed = true;
      });
    },
  };
  try {
    const power = await runtime.acquire(
      buildService(Power, PowerLive).pipe(
        Effect.provideService(PowerHost, createPowerHost(provider)),
        Effect.provideService(
          Daemons,
          dependency<Daemons>({
            shutdown: () =>
              Effect.sync(() => {
                daemonStopped = true;
              }),
          }),
        ),
        Effect.provideService(
          Processes,
          dependency<Processes>({
            shutdown: () =>
              Effect.sync(() => {
                expect(daemonStopped).toBe(true);
                processesStopped = true;
              }),
          }),
        ),
      ),
    );
    expect(power.getCapabilities()).toEqual({ poweroff: true, reboot: false });
    expect(() => power.assertAvailable({ action: "reboot" })).toThrow(
      PowerUnavailable,
    );
    const action = runtime.run(power.power({ action: "poweroff" }));
    await started;
    expect(() => power.assertAvailable({ action: "poweroff" })).toThrow(
      PowerPending,
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
      PowerDisposed,
    );
  } finally {
    finish();
    await runtime.dispose();
  }
});

it.each(["daemons", "processes", "host"] as const)(
  "preserves %s failure semantics and allows retry",
  async (participant) => {
    const runtime = createEffectRuntime();
    const cause = new Error("Power transition refused");
    let failing = true;
    const shutdown = (owner: "daemons" | "processes") =>
      failing && owner === participant ? Effect.die(cause) : Effect.void;
    try {
      const power = await runtime.acquire(
        buildService(Power, PowerLive).pipe(
          Effect.provideService(PowerHost, {
            getCapabilities: () => ({ poweroff: true, reboot: false }),
            perform: () =>
              failing && participant === "host"
                ? Effect.fail(cause)
                : Effect.void,
          }),
          Effect.provideService(
            Daemons,
            dependency<Daemons>({ shutdown: () => shutdown("daemons") }),
          ),
          Effect.provideService(
            Processes,
            dependency<Processes>({ shutdown: () => shutdown("processes") }),
          ),
        ),
      );
      const exit = await runtime.run(
        Effect.exit(power.power({ action: "poweroff" })),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(participant !== "host");
        expect(Cause.hasFails(exit.cause)).toBe(participant === "host");
        const failure = Cause.squash(exit.cause);
        if (participant === "host") {
          expect(failure).toMatchObject({
            _tag: "PowerHandoffFailed",
            action: "poweroff",
            cause,
            message: cause.message,
          });
          expect((failure as { cause: unknown }).cause).toBe(cause);
        } else {
          expect(failure).toBe(cause);
        }
      }
      failing = false;
      await expect(
        runtime.run(power.power({ action: "poweroff" })),
      ).resolves.toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  },
);

it("keeps unexpected host capability exceptions out of recoverable power failures", async () => {
  const runtime = createEffectRuntime();
  const defect = new Error("Broken capability implementation");
  try {
    const power = await runtime.acquire(
      buildService(Power, PowerLive).pipe(
        Effect.provideService(PowerHost, {
          getCapabilities: () => {
            throw defect;
          },
          perform: () => Effect.void,
        }),
        Effect.provideService(
          Daemons,
          dependency<Daemons>({ shutdown: () => Effect.void }),
        ),
        Effect.provideService(
          Processes,
          dependency<Processes>({ shutdown: () => Effect.void }),
        ),
      ),
    );
    const exit = await runtime.run(
      Effect.exit(power.power({ action: "poweroff" })),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
    }
  } finally {
    await runtime.dispose();
  }
});

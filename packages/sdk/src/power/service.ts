import type { EdenPowerCapabilities } from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { OperationReporter } from "../operations/task";

export type PowerAction = "poweroff" | "reboot";

export interface PowerHost {
  getCapabilities(): EdenPowerCapabilities;
  perform(action: PowerAction): Effect.Effect<void, Error>;
}

export interface PowerShutdown {
  shutdown(): Effect.Effect<void, Error>;
}

interface PowerDependencies {
  host?: PowerHost;
  daemons: PowerShutdown;
  processes: PowerShutdown;
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export const createPower = Effect.fn(function* ({
  host,
  daemons,
  processes,
}: PowerDependencies) {
  let pending = false;
  let disposed = false;
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      disposed = true;
      pending = false;
    }),
  );

  function getCapabilities(): EdenPowerCapabilities {
    return host?.getCapabilities() ?? { poweroff: false, reboot: false };
  }

  function assertAvailable({ action }: { action: PowerAction }): PowerHost {
    if (disposed) throw new Error("Power service disposed");
    if (pending) throw new Error("A system power action is already pending");
    if (!host) throw new Error("System power management is unavailable");
    if (!host.getCapabilities()[action])
      throw new Error(`System ${action} is unavailable`);
    return host;
  }

  const handoff = Effect.fn(function* (
    activeHost: PowerHost,
    action: PowerAction,
    reporter?: OperationReporter,
  ) {
    reporter?.update("preparing-host-handoff");
    yield* daemons.shutdown();
    yield* processes.shutdown();
    reporter?.update("host-handoff");
    yield* activeHost.perform(action);
  });

  const power = Effect.fn(function* (
    args: { action: PowerAction },
    reporter?: OperationReporter,
  ) {
    const activeHost = yield* Effect.try({
      try: () => assertAvailable(args),
      catch: asError,
    });
    pending = true;
    yield* handoff(activeHost, args.action, reporter).pipe(
      Effect.onError(() =>
        Effect.sync(() => {
          pending = false;
        }),
      ),
    );
  }, Effect.uninterruptible);

  return { getCapabilities, assertAvailable, power };
});

export type Power = Effect.Success<ReturnType<typeof createPower>>;

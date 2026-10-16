import type { EdenPowerCapabilities } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type { OperationReporter } from "../operations/OperationTask";
import type { PowerAction, PowerHost, PowerShutdown } from "./ports";

interface PowerDependencies {
  host?: PowerHost;
  daemons: PowerShutdown;
  processes: PowerShutdown;
}

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export function createPower({ host, daemons, processes }: PowerDependencies) {
  return Effect.gen(function* () {
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

    function validatePower({ action }: { action: PowerAction }): void {
      if (disposed) throw new Error("Power service disposed");
      if (pending) throw new Error("A system power action is already pending");
      if (!host) throw new Error("System power management is unavailable");
      if (action !== "poweroff" && action !== "reboot")
        throw new Error("Unsupported system power action");
      if (!host.getCapabilities()[action])
        throw new Error(`System ${action} is unavailable`);
    }

    function power(
      args: { action: PowerAction },
      reporter?: OperationReporter,
    ) {
      return Effect.uninterruptible(
        Effect.gen(function* () {
          yield* Effect.try({ try: () => validatePower(args), catch: asError });
          pending = true;
          yield* Effect.gen(function* () {
            reporter?.update("preparing-host-handoff");
            yield* daemons.shutdown();
            yield* processes.shutdown();
            reporter?.update("host-handoff");
            yield* host!.perform(args.action);
          }).pipe(
            Effect.onExit((exit) =>
              Exit.isFailure(exit)
                ? Effect.sync(() => {
                    pending = false;
                  })
                : Effect.void,
            ),
          );
        }),
      );
    }

    return { getCapabilities, validatePower, power };
  });
}

export type Power = Effect.Success<ReturnType<typeof createPower>>;

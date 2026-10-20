import type { EdenPowerCapabilities } from "@edenapp/types";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { OperationReporter } from "../operations/task";
import {
  PowerDisposed,
  type PowerError,
  PowerHandoffFailed,
  PowerPending,
  PowerShutdownFailed,
  PowerUnavailable,
} from "./errors";
import { PowerDaemons, PowerHost, PowerProcesses } from "./ports";
import type { PowerAction } from "./types";

export interface Power {
  getCapabilities: () => EdenPowerCapabilities;
  /** Throws a PowerAdmissionError synchronously before operation acceptance. */
  assertAvailable: ({ action }: { action: PowerAction }) => PowerHost;
  power: (
    args: { action: PowerAction },
    reporter?: OperationReporter | undefined,
  ) => Effect.Effect<void, PowerError>;
}

export const Power = Context.Service<"eden/Power", Power>("eden/Power");

export const PowerLive = Layer.effect(
  Power,
  Effect.gen(function* () {
    const host = yield* PowerHost;
    const daemons = yield* PowerDaemons;
    const processes = yield* PowerProcesses;
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
      if (disposed) throw new PowerDisposed();
      if (pending) throw new PowerPending();
      if (!host) throw new PowerUnavailable({ action, reason: "host" });
      if (!host.getCapabilities()[action])
        throw new PowerUnavailable({ action, reason: "action" });
      return host;
    }

    const handoff = Effect.fn(function* (
      activeHost: PowerHost,
      action: PowerAction,
      reporter?: OperationReporter,
    ) {
      reporter?.update("preparing-host-handoff");
      yield* daemons.shutdown().pipe(
        Effect.mapError(
          (cause) =>
            new PowerShutdownFailed({
              action,
              participant: "daemons",
              cause,
            }),
        ),
      );
      yield* processes.shutdown().pipe(
        Effect.mapError(
          (cause) =>
            new PowerShutdownFailed({
              action,
              participant: "processes",
              cause,
            }),
        ),
      );
      reporter?.update("host-handoff");
      yield* activeHost
        .perform(action)
        .pipe(
          Effect.mapError((cause) => new PowerHandoffFailed({ action, cause })),
        );
    });

    const power = Effect.fn(function* (
      args: { action: PowerAction },
      reporter?: OperationReporter,
    ) {
      const activeHost = yield* Effect.try({
        try: () => assertAvailable(args),
        catch: (error) => {
          if (
            error instanceof PowerDisposed ||
            error instanceof PowerPending ||
            error instanceof PowerUnavailable
          )
            return error;
          throw error;
        },
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
  }),
);

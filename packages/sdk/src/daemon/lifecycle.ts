import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import { listen } from "../events/scoped";
import { log } from "../logging/logger";
import type { Packages } from "../packages/service";
import type { Processes } from "../processes/service";
import type { DaemonDefinitionRemoveError, DaemonLaunchError } from "./errors";
import type { Daemons } from "./service";

/** Serialize supervision notifications within the runtime's lifecycle scope. */
export const connectDaemonLifecycle = Effect.fn(function* (
  daemons: Daemons,
  processes: Processes,
  packages: Packages,
) {
  const pending =
    yield* Queue.unbounded<
      Effect.Effect<void, DaemonLaunchError | DaemonDefinitionRemoveError>
    >();
  const enqueue = (
    work: Effect.Effect<void, DaemonLaunchError | DaemonDefinitionRemoveError>,
  ) => {
    Queue.offerUnsafe(pending, work);
  };
  yield* listen(processes.exited, ({ appId, code }) =>
    enqueue(daemons.processExited(appId, code)),
  );
  yield* listen(processes.stopped, ({ appId }) =>
    enqueue(daemons.processStopped(appId)),
  );
  yield* listen(processes.launched, ({ instance }) =>
    enqueue(daemons.processLaunched(instance.manifest.id, instance.owner.kind)),
  );
  yield* listen(processes.reloading, ({ appId }) =>
    enqueue(daemons.processReloading(appId)),
  );
  yield* listen(packages.uninstalled, (change) => {
    if (change.kind === "app")
      enqueue(daemons.packageUninstalled(change.packageId));
  });
  yield* Effect.addFinalizer(() => Queue.shutdown(pending));
  yield* Effect.forkScoped(
    Effect.forever(
      Queue.take(pending).pipe(
        Effect.flatten,
        Effect.catchCause((cause) =>
          Cause.hasInterruptsOnly(cause)
            ? Effect.failCause(cause)
            : Effect.sync(() =>
                log.error("Daemon supervision failed:", Cause.squash(cause)),
              ),
        ),
      ),
    ),
  );
});

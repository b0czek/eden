import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { log } from "../logging/logger";

/** Report failed background work while preserving ordinary cancellation. */
export const logBackgroundFailure =
  (message: string) =>
  <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | undefined, never, R> =>
    Effect.catchCause(work, (cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause).pipe(Effect.orDie)
        : reportCause(message, cause),
    );

/** Report every cleanup failure so the remaining shutdown phases still run. */
export const logCleanupFailure =
  (message: string) =>
  <A, E, R>(
    work: Effect.Effect<A, E, R>,
  ): Effect.Effect<A | undefined, never, R> =>
    Effect.catchCause(work, (cause) => reportCause(message, cause));

function reportCause<E>(message: string, cause: Cause.Cause<E>) {
  return Effect.sync(() => {
    log.error(message, Cause.squash(cause));
    return undefined;
  });
}

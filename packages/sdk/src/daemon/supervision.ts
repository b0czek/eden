import type { DaemonDefinition, DaemonRuntimeState } from "@edenapp/types";
import * as Cause from "effect/Cause";
import type * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Schedule from "effect/Schedule";

export interface DaemonState {
  state: DaemonRuntimeState;
  restartCount: number;
  lastError?: string;
  nextRestartAt?: number;
}

const attempt = <E>() => ({
  exited: Deferred.makeUnsafe<number>(),
  settled: Deferred.makeUnsafe<void, E>(),
});

/** One workflow owns launch, exit waiting, backoff, and stability for a daemon. */
export function createDaemonSupervisor<E extends Error>({
  clock,
  launch,
  adopted = false,
  retryInitialFailure = false,
  isCurrent,
  restartPolicy,
  initialRestartCount = 0,
  setState,
}: {
  clock: Clock.Clock;
  launch: Effect.Effect<void, E>;
  adopted?: boolean;
  retryInitialFailure?: boolean;
  isCurrent(): boolean;
  restartPolicy(): DaemonDefinition["restart"];
  initialRestartCount?: number;
  setState(state: DaemonState): Effect.Effect<void>;
}): DaemonSupervisor<E> {
  const ready = Deferred.makeUnsafe<void, E>();
  let pending = attempt<E>();
  const run = Effect.gen(function* () {
    let first = true;
    let restartCount = initialRestartCount;
    let lastError: string | undefined;
    const backoff = () =>
      Schedule.min([
        Schedule.exponential(Duration.seconds(2 ** restartCount)),
        Schedule.spaced(Duration.seconds(30)),
      ]).pipe(
        Schedule.tap(({ duration }) =>
          Effect.gen(function* () {
            yield* setState({
              state: "backoff",
              restartCount: ++restartCount,
              lastError,
              nextRestartAt:
                clock.currentTimeMillisUnsafe() + Duration.toMillis(duration),
            });
            yield* Deferred.succeed(ready, undefined);
            yield* Deferred.succeed(pending.settled, undefined);
          }),
        ),
      );
    let nextRestart = yield* Schedule.toStep(backoff());
    const cycle = Effect.gen(function* () {
      if (!isCurrent()) return false;
      const initial = first;
      first = false;
      if (!initial) pending = attempt<E>();
      const current = pending;
      const code = yield* Effect.scoped(
        Effect.gen(function* () {
          if (!(initial && adopted)) {
            yield* setState({ state: "starting", restartCount });
            if (!isCurrent()) return yield* Effect.interrupt;
            yield* launch;
          }
          if (!isCurrent()) return yield* Effect.interrupt;
          yield* setState({ state: "active", restartCount });
          yield* Deferred.succeed(ready, undefined);
          yield* Effect.forkScoped(
            Effect.sleep(Duration.seconds(60)).pipe(
              Effect.andThen(
                Effect.gen(function* () {
                  restartCount = 0;
                  nextRestart = yield* Schedule.toStep(backoff());
                  yield* setState({ state: "active", restartCount });
                }),
              ),
            ),
          );
          return yield* Deferred.await(current.exited);
        }),
      ).pipe(
        Effect.catch((error) =>
          Effect.gen(function* () {
            yield* setState({
              state: "failed",
              restartCount,
              lastError: error.message,
            });
            if (initial && !retryInitialFailure) {
              yield* Deferred.fail(ready, error);
              return undefined;
            }
            return 1;
          }),
        ),
      );
      if (code === undefined || !isCurrent()) return false;
      lastError = `Exited with code ${code}`;
      const policy = restartPolicy();
      if (policy !== "always" && !(policy === "on-failure" && code !== 0)) {
        yield* setState({
          state: code === 0 ? "inactive" : "failed",
          restartCount,
          lastError: code === 0 ? undefined : lastError,
        });
        yield* Deferred.succeed(ready, undefined);
        return false;
      }
      return true;
    });
    yield* Effect.repeat(
      cycle,
      Schedule.fromStep(
        Effect.succeed((now, restart: boolean) =>
          restart && isCurrent()
            ? nextRestart(now, restart)
            : Cause.done(Duration.zero),
        ),
      ),
    );
  }).pipe(
    Effect.asVoid,
    Effect.onExit((exit) =>
      Effect.andThen(
        Deferred.done(ready, exit),
        Deferred.done(
          pending.settled,
          Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
            ? Exit.void
            : exit,
        ),
      ),
    ),
  );

  function terminated(code: number) {
    // Capture this attempt before a queued notification can observe its replacement.
    const current = pending;
    return Effect.suspend(() =>
      isCurrent()
        ? Effect.andThen(
            Deferred.succeed(current.exited, code),
            Deferred.await(current.settled),
          )
        : Effect.void,
    );
  }

  return { run, ready: Deferred.await(ready), terminated };
}

export interface DaemonSupervisor<E> {
  readonly run: Effect.Effect<void>;
  readonly ready: Effect.Effect<void, E>;
  terminated(code: number): Effect.Effect<void, E>;
}

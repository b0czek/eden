import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import * as Scope from "effect/Scope";

interface ServiceLifetime {
  readonly scope: Scope.Scope;
}

const ServiceLifetime = Context.Service<ServiceLifetime>(
  "eden/ServiceLifetime",
);

/** One execution boundary and resource owner for an Eden runtime's Effect services. */
export function createEffectRuntime() {
  const runtime = ManagedRuntime.make(
    Layer.effect(
      ServiceLifetime,
      Effect.map(Effect.scope, (scope) => ({ scope })),
    ),
  );
  let disposal: Promise<void> | undefined;

  function run<A, E>(work: Effect.Effect<A, E>): Promise<A> {
    if (disposal)
      return Promise.reject(new Error("Eden Effect runtime disposed"));
    return runtime.runPromise(work);
  }

  function fork<A, E>(work: Effect.Effect<A, E>): Fiber.Fiber<A, E> {
    if (disposal) throw new Error("Eden Effect runtime disposed");
    return runtime.runFork(work);
  }

  function own<A, E>(factory: Effect.Effect<A, E, Scope.Scope>) {
    return Effect.gen(function* () {
      const { scope } = yield* ServiceLifetime;
      const owned = yield* Scope.fork(scope);
      return yield* Scope.provide(factory, owned).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit) ? Scope.close(owned, exit) : Effect.void,
        ),
      );
    });
  }

  function acquire<A, E>(
    factory: Effect.Effect<A, E, Scope.Scope>,
  ): Promise<A> {
    if (disposal)
      return Promise.reject(new Error("Eden Effect runtime disposed"));
    return runtime.runPromise(own(factory));
  }

  /** Retain an acquisition program's fiber and own its resources until disposal. */
  function forkScoped<A, E>(
    factory: Effect.Effect<A, E, Scope.Scope>,
  ): Fiber.Fiber<A, E> {
    if (disposal) throw new Error("Eden Effect runtime disposed");
    return runtime.runFork(own(factory));
  }

  function dispose(): Promise<void> {
    disposal ??= runtime.dispose();
    return disposal;
  }

  return { run, fork, acquire, forkScoped, dispose };
}

export type EffectRuntime = ReturnType<typeof createEffectRuntime>;

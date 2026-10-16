import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
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

  function acquire<A, E>(
    factory: Effect.Effect<A, E, Scope.Scope>,
  ): Promise<A> {
    if (disposal)
      return Promise.reject(new Error("Eden Effect runtime disposed"));
    return runtime.runPromise(
      Effect.gen(function* () {
        const { scope } = yield* ServiceLifetime;
        const owned = yield* Scope.fork(scope);
        return yield* Scope.provide(factory, owned).pipe(
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Scope.close(owned, exit) : Effect.void,
          ),
        );
      }),
    );
  }

  function dispose(): Promise<void> {
    disposal ??= runtime.dispose();
    return disposal;
  }

  return { run, acquire, dispose };
}

export type EffectRuntime = ReturnType<typeof createEffectRuntime>;

/** Temporary DI boundary while the remaining runtime services are converted. */
export const EFFECT_RUNTIME = Symbol("Eden Effect runtime");

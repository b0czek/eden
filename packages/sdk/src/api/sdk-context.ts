import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { EventListener } from "../core/events/event";
import type { ExecutionContext } from "../core/execution/context";
import type { Operations } from "../core/operations/service";
import type { OperationTask } from "../core/operations/task";
import type { EdenInputError } from "./control-plane";

/** Trusted SDK work acquires host authority only when it executes. */
export function createSdkContext({
  execution,
  operations,
}: {
  execution: Pick<ExecutionContext, "provide">;
  operations: Pick<Operations, "runHost">;
}) {
  function run<A>(work: () => A): A {
    // @eden-effect-next-line domain-interpreter -- Synchronous host methods and native notifications enter an isolated caller context at the SDK boundary.
    return Effect.runSync(
      execution.provide(Effect.sync(work), {
        principal: { kind: "system" },
      }),
    );
  }
  function effect<A, E>(
    work: () => Effect.Effect<A, E>,
  ): Effect.Effect<A, E | EdenInputError> {
    return execution.provide(
      Effect.try({
        try: work,
        catch: (cause) => {
          if (cause instanceof v.ValiError) return cause;
          throw cause;
        },
      }).pipe(Effect.flatten),
      { principal: { kind: "system" } },
    );
  }
  function operation<R, E, P>(
    command: string,
    args: unknown,
    prepare: Effect.Effect<OperationTask<R, E>, P>,
  ) {
    return effect(() => operations.runHost(command, args, prepare));
  }
  function subscribe<A>(
    listener: EventListener<A>,
    connect: (notify: EventListener<A>) => () => void,
  ): () => void {
    v.parse(v.function(), listener);
    const stop = run(() =>
      connect((payload) => run(() => listener(structuredClone(payload)))),
    );
    return () => run(stop);
  }
  return { run, effect, operation, subscribe };
}
export type SdkContext = ReturnType<typeof createSdkContext>;

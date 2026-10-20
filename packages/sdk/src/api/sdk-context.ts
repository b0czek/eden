import * as Effect from "effect/Effect";
import * as v from "valibot";
import type { ExecutionContext } from "../execution/context";
import type { Operations } from "../operations/service";
import type { OperationTask } from "../operations/task";
import type { EdenInputError } from "./control-plane";

/** Trusted SDK work acquires host authority only when it executes. */
export function createSdkContext({
  execution,
  operations,
}: {
  execution: Pick<ExecutionContext, "run" | "provide">;
  operations: Pick<Operations, "runHost">;
}) {
  function run<A>(work: () => A): A {
    return execution.run({ principal: { kind: "system" } }, work);
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
      }).pipe(Effect.flatMap((work) => work)),
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
  return { run, effect, operation };
}
export type SdkContext = ReturnType<typeof createSdkContext>;

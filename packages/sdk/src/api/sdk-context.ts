import * as Effect from "effect/Effect";
import { asError } from "../effects/io";
import type { ExecutionContext } from "../execution/context";
import type { Operations } from "../operations/service";
import type { OperationTask } from "../operations/task";

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
  ): Effect.Effect<A, Error> {
    return execution.provide(
      Effect.try({ try: work, catch: asError }).pipe(
        Effect.flatMap((work) => work),
        Effect.mapError(asError),
      ),
      { principal: { kind: "system" } },
    );
  }
  function operation<R>(
    command: string,
    args: unknown,
    prepare: () => OperationTask<R>,
  ) {
    return effect(() => operations.runHost(command, args, prepare));
  }
  return { run, effect, operation };
}
export type SdkContext = ReturnType<typeof createSdkContext>;

import type * as Effect from "effect/Effect";
import type { EffectRuntime } from "../effects/runtime";
import type { ExecutionContext } from "../execution/context";
import type { Operations } from "../operations/service";
import type { OperationTask } from "../operations/task";

/** Trusted SDK entry points execute independently of any ambient app caller. */
export function createSdkContext({
  execution,
  effects,
  operations,
}: {
  execution: Pick<ExecutionContext, "run">;
  effects: Pick<EffectRuntime, "run">;
  operations: Pick<Operations, "runHost">;
}) {
  function run<A>(work: () => A): A {
    return execution.run({ principal: { kind: "system" } }, work);
  }

  function effect<A, E>(work: Effect.Effect<A, E>): Promise<A> {
    return run(() => effects.run(work));
  }

  function operation<R>(
    command: string,
    args: unknown,
    prepare: () => OperationTask<R>,
  ): Promise<R> {
    return effect(operations.runHost(command, args, prepare));
  }

  return { run, effect, operation };
}

export type SdkContext = ReturnType<typeof createSdkContext>;

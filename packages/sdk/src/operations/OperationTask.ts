import type { OperationProgress } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface OperationReporter {
  readonly signal?: AbortSignal;
  update(phase: string, progress?: OperationProgress): void;
}

/** Prepared synchronously; execution belongs to the runtime after acceptance. */
export interface OperationTask<R> {
  run(reporter: OperationReporter): Promise<R> | Effect.Effect<R, unknown>;
  cancellable?: boolean;
  transition?: "session" | "runtime";
}

export function operationTask<R>(
  run: OperationTask<R>["run"],
  options: Omit<OperationTask<R>, "run"> = {},
): OperationTask<R> {
  return { run, ...options };
}

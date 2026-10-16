import type { OperationProgress } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface OperationReporter {
  update(phase: string, progress?: OperationProgress): void;
}

/** Prepared synchronously; execution belongs to the runtime after acceptance. */
export interface OperationTask<R> {
  run(reporter: OperationReporter): Effect.Effect<R, unknown>;
  /** Release synchronous admission even if cancellation precedes execution. */
  release?: () => void;
  /** Public response encoding supplied by the controller; execution still fails. */
  encodeFailure?: (error: unknown) => R;
  cancellable?: boolean;
  transition?: "session" | "runtime";
}

export function operationTask<R>(
  run: OperationTask<R>["run"],
  options: Omit<OperationTask<R>, "run"> = {},
): OperationTask<R> {
  return { run, ...options };
}

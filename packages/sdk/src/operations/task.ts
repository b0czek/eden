import type { OperationProgress } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export interface OperationReporter {
  update(phase: string, progress?: OperationProgress): void;
}

/** Prepared synchronously; execution belongs to the runtime after acceptance. */
export interface OperationTask<R, E = unknown> {
  run(reporter: OperationReporter): Effect.Effect<R, E>;
  /** Release synchronous admission even if cancellation precedes execution. */
  release?: () => void;
  /** Public response encoding supplied by the controller; execution still fails. */
  encodeFailure?(error: E): R;
  cancellable?: boolean;
  transition?: "session" | "runtime";
}

export function operationTask<R, E = unknown>(
  run: OperationTask<R, E>["run"],
  options: Omit<OperationTask<R, E>, "run"> = {},
): OperationTask<R, E> {
  return { run, ...options };
}

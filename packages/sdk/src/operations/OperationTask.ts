import type { OperationProgress } from "@edenapp/types";

export interface OperationReporter {
  update(phase: string, progress?: OperationProgress): void;
}

/** Prepared synchronously; execution belongs to the runtime after acceptance. */
export interface OperationTask<R> {
  run(reporter: OperationReporter): Promise<R>;
  transition?: "session" | "runtime";
  isFailure?(result: R): boolean;
}

export function operationTask<R>(
  run: OperationTask<R>["run"],
  options: Omit<OperationTask<R>, "run"> = {},
): OperationTask<R> {
  return { run, ...options };
}

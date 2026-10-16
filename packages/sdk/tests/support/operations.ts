import { fromPromise } from "../../src/effects/io";
import {
  type OperationReporter,
  type OperationTask,
  operationTask,
} from "../../src/operations/task";

/** Adapt Promise-based fixture I/O before handing it to the operation runtime. */
export function promiseOperationTask<R>(
  run: (reporter: OperationReporter) => Promise<R>,
  options: Omit<OperationTask<R>, "run"> = {},
): OperationTask<R> {
  return operationTask((reporter) => fromPromise(() => run(reporter)), options);
}

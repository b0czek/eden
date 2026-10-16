import { types } from "node:util";
import * as Effect from "effect/Effect";

export const asError = (error: unknown): Error =>
  types.isNativeError(error) || error instanceof Error
    ? error
    : new Error(String(error));

/** Adapt a Promise-based I/O boundary without starting work eagerly. */
export function fromPromise<A>(
  evaluate: (signal: AbortSignal) => PromiseLike<A>,
) {
  return Effect.callback<A, Error>((resume, signal) => {
    let pending: Promise<A>;
    try {
      pending = Promise.resolve(evaluate(signal));
    } catch (error) {
      resume(Effect.fail(asError(error)));
      return;
    }
    pending.then(
      (value) => resume(Effect.succeed(value)),
      (error) => resume(Effect.fail(asError(error))),
    );
    // Native I/O may need time to stop after its signal is aborted. Keep its
    // resources owned until that cleanup has actually completed.
    return Effect.promise(() =>
      pending.then(
        () => undefined,
        () => undefined,
      ),
    );
  });
}

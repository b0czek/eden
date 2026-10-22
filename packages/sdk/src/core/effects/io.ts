import { types } from "node:util";
import * as Effect from "effect/Effect";

export const asError = (error: unknown): Error =>
  types.isNativeError(error) || error instanceof Error
    ? error
    : new Error(String(error));

/** Adapt a Promise-based I/O boundary without starting work eagerly. */
export function fromPromise<A>(
  evaluate: (signal: AbortSignal) => PromiseLike<A>,
): Effect.Effect<A, Error>;
export function fromPromise<A, E>(
  evaluate: (signal: AbortSignal) => PromiseLike<A>,
  onError: (error: unknown) => E,
): Effect.Effect<A, E>;
export function fromPromise<A, E>(
  evaluate: (signal: AbortSignal) => PromiseLike<A>,
  onError?: (error: unknown) => E,
): Effect.Effect<A, E | Error> {
  // The overload without a mapper returns Error; the mapper overload preserves E.
  // @effect-diagnostics-next-line missingEffectError:off -- The diagnostic compares this implementation with only the first overload.
  return Effect.callback<A, E | Error>((resume, signal) => {
    const reject = (error: unknown) =>
      resume(
        Effect.suspend(() =>
          Effect.fail(onError ? onError(error) : asError(error)),
        ),
      );
    let pending: Promise<A>;
    try {
      pending = Promise.resolve(evaluate(signal));
    } catch (error) {
      reject(error);
      return;
    }
    pending.then((value) => resume(Effect.succeed(value)), reject);
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

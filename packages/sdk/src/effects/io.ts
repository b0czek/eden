import { types } from "node:util";
import * as Effect from "effect/Effect";

export const asError = (error: unknown): Error =>
  types.isNativeError(error) || error instanceof Error
    ? error
    : new Error(String(error));

/** Adapt a Promise-based I/O boundary without starting work eagerly. */
export function fromPromise<A>(evaluate: () => PromiseLike<A>) {
  return Effect.tryPromise({
    try: () => Promise.resolve(evaluate()),
    catch: asError,
  });
}

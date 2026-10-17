import * as fs from "node:fs";
import * as Cache from "effect/Cache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { fromPromise } from "../effects/io";

export const createCachedFileReader = Effect.fn(function* () {
  const cache = yield* Cache.makeWith(
    (filePath: string) =>
      fromPromise(() => fs.promises.readFile(filePath, "utf-8")),
    {
      capacity: Number.POSITIVE_INFINITY,
      // Assets stay fixed for this rendering scope; failed reads must be retryable.
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? Duration.infinity : Duration.zero,
    },
  );
  yield* Effect.addFinalizer(() => Cache.invalidateAll(cache));
  return { read: (filePath: string) => Cache.get(cache, filePath) };
});

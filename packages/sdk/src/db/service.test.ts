import * as Effect from "effect/Effect";
import { createDb } from "./service";

it("preserves a storage rejection and defers writes until the effect executes", async () => {
  const failure = new Error("Storage unavailable");
  const writes: Array<[string, string]> = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* createDb({
          open: Effect.succeed({
            read: () => Effect.fail(failure),
            write: (key, value) =>
              Effect.sync(() => {
                writes.push([key, value]);
              }),
            remove: () => Effect.succeed(false),
            keys: () => Effect.succeed([]),
          }),
        });
        expect(yield* Effect.flip(db.get("app.first", "theme"))).toBe(failure);
        const write = db.set("app.first", "theme", "dark");
        expect(writes).toEqual([]);
        yield* write;
        expect(writes).toEqual([["app.first:theme", "dark"]]);
      }),
    ),
  );
});

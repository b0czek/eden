import * as Effect from "effect/Effect";
import { buildService } from "../../tests/support/effect-runtime";
import { StorageReadError } from "../storage/errors";
import { DbInvalidValueError } from "./errors";
import { DbStorage } from "./ports";
import { Db, DbLive } from "./service";

it("preserves typed storage failures, defers writes, and rejects non-string values without writing", async () => {
  const failure = new StorageReadError({
    resource: "storage.db",
    operation: "read",
    keys: ["app.first:theme"],
    cause: new Error("Storage unavailable"),
  });
  const writes: Array<[string, string]> = [];
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* buildService(Db, DbLive).pipe(
          Effect.provideService(DbStorage, {
            read: () => Effect.fail(failure),
            write: (key, value) =>
              Effect.sync(() => {
                writes.push([key, value]);
              }),
            remove: () => Effect.succeed(false),
            keys: () => Effect.succeed([]),
          }),
        );
        expect(yield* Effect.flip(db.get("app.first", "theme"))).toBe(failure);
        const write = db.set("app.first", "theme", "dark");
        expect(writes).toEqual([]);
        yield* write;
        expect(writes).toEqual([["app.first:theme", "dark"]]);
        const invalidValue = yield* Effect.flip(
          db.set("app.first", "theme", 42 as unknown as string),
        );
        expect(invalidValue).toBeInstanceOf(DbInvalidValueError);
        expect(invalidValue).toMatchObject({
          appId: "app.first",
          key: "theme",
          valueType: "number",
          message: "Value must be a string, got number",
        });
        expect(writes).toEqual([["app.first:theme", "dark"]]);
      }),
    ),
  );
});

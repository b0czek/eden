import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import KeyvSqlite from "@keyv/sqlite";
import * as Effect from "effect/Effect";
import {
  StorageClosedError,
  type StorageFailure,
  StorageOpenError,
  StorageReadError,
  StorageRemoveError,
  StorageWriteError,
} from "../../../src/storage/errors";
import { openKeyvSqlite } from "../../../src/storage/keyv-sqlite";
import { createEffectRuntime } from "../../support/effect-runtime";

it("reports an unusable native connection during acquisition, retaining its cause", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-storage-"));
  const runtime = createEffectRuntime();
  const resource = path.join(directory, "missing", "storage.db");
  try {
    const result = await runtime.run(
      Effect.result(
        Effect.scoped(
          openKeyvSqlite({
            dbPath: resource,
            label: "test storage",
            closedMessage: "Storage closed",
          }),
        ),
      ),
    );
    expect(result._tag).toBe("Failure");
    if (result._tag !== "Failure")
      throw new Error("Expected acquisition failure");
    expect(result.failure).toBeInstanceOf(StorageOpenError);
    expect(result.failure.resource).toBe(resource);
    expect(result.failure.cause).toMatchObject({ code: "SQLITE_CANTOPEN" });
    // Failed acquisition must not turn cleanup rejection into a second failure.
    await expect(runtime.dispose()).resolves.toBeUndefined();
  } finally {
    await runtime.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

it("distinguishes native read, write and removal failures from missing data and releases its connection", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-storage-"));
  const runtime = createEffectRuntime();
  const resource = path.join(directory, "storage.db");
  let maintenance: KeyvSqlite | undefined;
  try {
    const storage = await runtime.acquire(
      openKeyvSqlite({
        dbPath: resource,
        label: "test storage",
        closedMessage: "Storage closed",
      }),
    );
    expect(await runtime.run(storage.read("missing"))).toBeUndefined();
    expect(await runtime.run(storage.readMany(["missing"]))).toEqual([
      undefined,
    ]);
    expect(await runtime.run(storage.remove("missing"))).toBe(false);
    await runtime.run(storage.write("saved", 42));
    expect(await runtime.run(storage.read("saved"))).toBe(42);

    maintenance = new KeyvSqlite(`sqlite://${resource}`);
    await maintenance.query("DROP TABLE keyv");
    const attempts: {
      work: Effect.Effect<unknown, StorageFailure>;
      error:
        | typeof StorageReadError
        | typeof StorageWriteError
        | typeof StorageRemoveError;
      context: object;
    }[] = [
      {
        work: storage.read("saved"),
        error: StorageReadError,
        context: { operation: "read", keys: ["saved"] },
      },
      {
        work: storage.readMany(["saved", "missing"]),
        error: StorageReadError,
        context: { operation: "readMany", keys: ["saved", "missing"] },
      },
      {
        work: storage.write("saved", 43),
        error: StorageWriteError,
        context: { key: "saved" },
      },
      {
        work: storage.remove("saved"),
        error: StorageRemoveError,
        context: { key: "saved" },
      },
    ];
    for (const { work, error, context } of attempts) {
      const result = await runtime.run(Effect.result(work));
      expect(result._tag).toBe("Failure");
      if (result._tag !== "Failure") throw new Error("Expected native failure");
      expect(result.failure).toBeInstanceOf(error);
      expect(result.failure).toMatchObject({
        resource,
        ...context,
        cause: { code: "SQLITE_ERROR" },
      });
      expect(result.failure.message).toContain("no such table");
    }
    await runtime.dispose();
    const closed = await Effect.runPromise(
      Effect.result(storage.read("saved")),
    );
    expect(closed._tag).toBe("Failure");
    if (closed._tag !== "Failure") throw new Error("Expected closed failure");
    expect(closed.failure).toBeInstanceOf(StorageClosedError);
    expect(closed.failure).toMatchObject({
      resource,
      operation: "read",
      keys: ["saved"],
      message: "Storage closed",
    });
  } finally {
    await runtime.dispose();
    await maintenance?.disconnect();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

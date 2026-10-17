import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import KeyvSqlite from "@keyv/sqlite";
import * as Effect from "effect/Effect";
import Keyv from "keyv";
import { createDb, createSqliteDbStorage } from "../../../src/db";
import { createTestCaller } from "../../support/callers";
import { createTestEden } from "../../support/createTestEden";
import { createEffectRuntime } from "../../support/effect-runtime";

it("isolates app namespaces using trusted callers and gates cross-app commands", async () => {
  const eden = await createTestEden();
  try {
    const { caller } = await createTestCaller(eden, "app.first", ["db/rw"]);
    const permissions = eden.runtime.services.permissions;
    permissions.registerApp("app.second", ["db/rw"]);
    permissions.registerApp("app.admin", ["db/superuser"]);
    permissions.registerApp("app.denied", []);
    const second = { ...caller, appId: "app.second" };
    const admin = { ...caller, appId: "app.admin" };

    expect(
      await eden.execute("db/set", { key: "theme", value: "light" }, second),
    ).toEqual({ success: true });
    expect(
      await eden.execute(
        "db/set",
        { key: "theme", value: "dark", _callerAppId: "app.second" },
        caller,
      ),
    ).toEqual({ success: true });
    expect(await eden.execute("db/get", { key: "theme" }, caller)).toEqual({
      value: "dark",
    });
    expect(await eden.execute("db/get", { key: "theme" }, second)).toEqual({
      value: "light",
    });
    await expect(
      eden.execute("db/get/su", { appId: "app.second", key: "theme" }, caller),
    ).rejects.toThrow("Permission denied");
    await expect(
      eden.execute(
        "db/get",
        { key: "theme" },
        { ...caller, appId: "app.denied" },
      ),
    ).rejects.toThrow("Permission denied");
    await expect(
      eden.execute("db/get", { key: "theme", _callerAppId: "app.second" }),
    ).rejects.toThrow("caller app identity");

    expect(
      await eden.execute(
        "db/get/su",
        { appId: "app.second", key: "theme" },
        admin,
      ),
    ).toEqual({ value: "light" });
    await eden.execute(
      "db/set/su",
      { appId: "app.second", key: "draft:one", value: "saved" },
      admin,
    );
    const listed = await eden.execute<{ keys: string[] }>(
      "db/list",
      {},
      second,
    );
    expect(listed.keys.sort()).toEqual(["draft:one", "theme"]);
    expect(
      await eden.execute(
        "db/has/su",
        { appId: "app.second", key: "draft:one" },
        admin,
      ),
    ).toEqual({ exists: true });
    expect(
      await eden.execute(
        "db/delete/su",
        { appId: "app.second", key: "draft:one" },
        admin,
      ),
    ).toEqual({ success: true });
    expect(
      await eden.execute("db/delete", { key: "draft:one" }, second),
    ).toEqual({ success: false });
    expect(await eden.execute("db/clear", {}, caller)).toEqual({
      success: true,
    });
    expect(await eden.execute("db/has", { key: "theme" }, caller)).toEqual({
      exists: false,
    });
    expect(
      await eden.execute("db/list/su", { appId: "app.second" }, admin),
    ).toEqual({ keys: ["theme"] });
    expect(
      await eden.execute("db/clear/su", { appId: "app.second" }, admin),
    ).toEqual({ success: true });
    expect(await eden.execute("db/list", {}, second)).toEqual({ keys: [] });
  } finally {
    await eden.dispose();
  }
});

it("acquires SQLite lazily, drains accepted writes on disposal, and reopens saved data", async () => {
  const appsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-db-"));
  const first = createEffectRuntime();
  const second = createEffectRuntime();
  try {
    const acquisition = createDb(createSqliteDbStorage({ appsDirectory }));
    expect(await fs.readdir(appsDirectory)).toEqual([]);
    const db = await first.acquire(acquisition);
    expect(await first.run(db.get("app.first", "pending"))).toBeUndefined();
    const update = db.set("app.first", "pending", "saved");
    expect(await first.run(db.get("app.first", "pending"))).toBeUndefined();

    const write = first.run(update);
    // Disposal may interrupt the caller; the accepted SQLite write must settle
    // before its connection closes, even when that caller sees interruption.
    const [, disposal] = await Promise.allSettled([write, first.dispose()]);
    expect(disposal.status).toBe("fulfilled");

    const reopened = await second.acquire(
      createDb(createSqliteDbStorage({ appsDirectory })),
    );
    expect(await second.run(reopened.get("app.first", "pending"))).toBe(
      "saved",
    );
    expect(
      await second.run(reopened.get("app.second", "pending")),
    ).toBeUndefined();
    await expect(
      Effect.runPromise(db.get("app.first", "pending")),
    ).rejects.toThrow("Database connection closed");
  } finally {
    await first.dispose();
    await second.dispose();
    await fs.rm(appsDirectory, { recursive: true, force: true });
  }
});

it("reads legacy non-string values and keeps listing permissive when SQLite iteration fails", async () => {
  const appsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-db-"));
  const runtime = createEffectRuntime();
  try {
    const filename = path.join(appsDirectory, "storage.db");
    const legacy = new Keyv({ store: new KeyvSqlite(`sqlite://${filename}`) });
    try {
      await legacy.set("app.first:legacy", 42);
    } finally {
      await legacy.disconnect();
    }
    const db = await runtime.acquire(
      createDb(createSqliteDbStorage({ appsDirectory })),
    );
    expect(await runtime.run(db.get("app.first", "legacy"))).toBe("42");

    const maintenance = new KeyvSqlite(`sqlite://${filename}`);
    try {
      await maintenance.query("DROP TABLE keyv");
      expect(await runtime.run(db.list("app.first"))).toEqual([]);
    } finally {
      await maintenance.disconnect();
    }
  } finally {
    await runtime.dispose();
    await fs.rm(appsDirectory, { recursive: true, force: true });
  }
});

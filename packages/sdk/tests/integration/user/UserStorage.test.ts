import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { AppsDirectory } from "../../../src/runtime/inputs";
import { openKeyvSqlite } from "../../../src/storage/keyv-sqlite";
import { UserStorage, UserStorageLive } from "../../../src/user/storage";
import type { StoredUser } from "../../../src/user/types";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";

function user(username: string): StoredUser {
  return {
    username,
    name: username,
    role: "standard",
    grants: [],
    createdAt: 1,
    updatedAt: 1,
    passwordHash: "hash",
    passwordSalt: "salt",
  };
}

describe("user record and index persistence", () => {
  let directory: string;
  let effects: ReturnType<typeof createEffectRuntime>;
  let store: UserStorage;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "eden-user-storage-"));
    effects = createEffectRuntime();
    store = await effects.acquire(
      buildService(UserStorage, UserStorageLive).pipe(
        Effect.provideService(AppsDirectory, directory),
      ),
    );
  });

  afterEach(async () => {
    await effects.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  });

  async function expectUsers(expected: StoredUser[]) {
    const names = expected.map(({ username }) => username).sort();
    expect((await effects.run(store.getUserIndex())).sort()).toEqual(names);
    for (const record of expected) {
      expect(await effects.run(store.getUserRecord(record.username))).toEqual(
        record,
      );
    }
  }

  it("recovers malformed legacy values and restores absent grants", async () => {
    const raw = await effects.acquire(
      openKeyvSqlite({
        dbPath: path.join(directory, "users.db"),
        label: "legacy user fixture",
        closedMessage: "Legacy fixture closed",
      }),
    );
    await effects.run(raw.write("users:index", "not JSON"));
    await effects.run(raw.write("user:broken", "{broken"));
    await effects.run(raw.write("users:default", 42));
    expect(await effects.run(store.getUserIndex())).toEqual([]);
    expect(await effects.run(store.getUserRecord("broken"))).toBeNull();
    expect(await effects.run(store.getDefaultUsername())).toBeNull();
    await effects.run(raw.write("users:index", ["operator", 42]));
    await effects.run(raw.write("user:broken", { grants: [] }));
    expect(await effects.run(store.getUserIndex())).toEqual([]);
    expect(await effects.run(store.getUserRecord("broken"))).toBeNull();

    const { grants: _grants, ...legacy } = user("legacy");
    await effects.run(raw.write("users:index", JSON.stringify(["legacy"])));
    await effects.run(raw.write("user:legacy", JSON.stringify(legacy)));
    expect(await effects.run(store.getUserIndex())).toEqual(["legacy"]);
    expect(await effects.run(store.getUserRecord("legacy"))).toEqual(
      user("legacy"),
    );
  });

  it("rejects reads after its owning scope closes with storage context", async () => {
    await effects.dispose();
    effects = createEffectRuntime();
    await expect(
      effects.run(store.getUserRecord("operator")),
    ).rejects.toMatchObject({
      _tag: "StorageClosedError",
      resource: path.join(directory, "users.db"),
      operation: "read",
      keys: ["user:operator"],
    });
  });

  it("retains every record in the index after twelve concurrent saves and reopening", async () => {
    const records = Array.from({ length: 12 }, (_, index) =>
      user(`user-${index}`),
    );
    await effects.run(
      Effect.forEach(records, store.saveUserRecord, {
        concurrency: "unbounded",
      }),
    );
    await expectUsers(records);
    await effects.dispose();
    effects = createEffectRuntime();
    store = await effects.acquire(
      buildService(UserStorage, UserStorageLive).pipe(
        Effect.provideService(AppsDirectory, directory),
      ),
    );
    await expectUsers(records);
  });

  it("keeps concurrent deletions and saves from overwriting each other's index updates", async () => {
    const original = Array.from({ length: 12 }, (_, index) =>
      user(`original-${index}`),
    );
    await effects.run(Effect.forEach(original, store.saveUserRecord));
    const removed = original.slice(0, 6);
    const added = Array.from({ length: 6 }, (_, index) =>
      user(`added-${index}`),
    );
    await effects.run(
      Effect.all(
        [
          ...removed.map(({ username }) => store.deleteUserRecord(username)),
          ...added.map(store.saveUserRecord),
        ],
        { concurrency: "unbounded" },
      ),
    );
    await expectUsers([...original.slice(6), ...added]);
    for (const { username } of removed) {
      expect(await effects.run(store.getUserRecord(username))).toBeNull();
    }
  });
});

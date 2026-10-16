import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test as nodeTest } from "node:test";
import * as Effect from "effect/Effect";
import { createFilesystemTransfer } from "../../../src/filesystem/FilesystemTransfer";

const test = typeof it === "function" ? it : nodeTest;

async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-transfer-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

for (const operation of ["copy", "move"] as const) {
  test(`concurrent ${operation} without overwrite preserves the winning destination`, async () => {
    await fixture(async (root) => {
      const transfer = createFilesystemTransfer();
      const sources = [path.join(root, "first"), path.join(root, "second")];
      const contents = [
        "first source".repeat(100000),
        "second source".repeat(100000),
      ];
      await Promise.all(
        sources.map((source, index) => fs.writeFile(source, contents[index])),
      );
      const destination = path.join(root, "destination");
      const outcomes = await Promise.allSettled(
        sources.map((source) =>
          Effect.runPromise(
            transfer[operation]({
              source,
              destination,
              destinationLabel: destination,
              overwrite: false,
              reporter: { update() {} },
            }),
          ),
        ),
      );
      const winner = outcomes.findIndex(
        (result) => result.status === "fulfilled",
      );
      assert.equal(
        outcomes.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        outcomes.filter((result) => result.status === "rejected").length,
        1,
      );
      assert.equal(await fs.readFile(destination, "utf8"), contents[winner]);
      const loser = winner === 0 ? 1 : 0;
      assert.equal(await fs.readFile(sources[loser], "utf8"), contents[loser]);
      if (operation === "copy") {
        assert.equal(
          await fs.readFile(sources[winner], "utf8"),
          contents[winner],
        );
      } else {
        await assert.rejects(fs.stat(sources[winner]), { code: "ENOENT" });
      }
    });
  });

  test(`failed overwrite ${operation} restores the previous destination and releases admission`, async () => {
    await fixture(async (root) => {
      const transfer = createFilesystemTransfer();
      const source = path.join(root, "source");
      const replacement = path.join(root, "replacement");
      const destination = path.join(root, "destination");
      await Promise.all([
        fs.writeFile(source, "failing replacement"),
        fs.writeFile(replacement, "successful replacement"),
        fs.writeFile(destination, "original"),
      ]);
      await assert.rejects(
        Effect.runPromise(
          transfer[operation]({
            source,
            destination,
            destinationLabel: destination,
            overwrite: true,
            assertSourceActive: async () => {
              try {
                await fs.stat(destination);
              } catch (error) {
                if ((error as NodeJS.ErrnoException).code === "ENOENT") {
                  throw new Error("source disconnected");
                }
                throw error;
              }
            },
            reporter: { update() {} },
          }),
        ),
        /source disconnected/,
      );
      assert.equal(await fs.readFile(destination, "utf8"), "original");
      await Effect.runPromise(
        transfer.copy({
          source: replacement,
          destination,
          destinationLabel: destination,
          overwrite: true,
        }),
      );
      assert.equal(
        await fs.readFile(destination, "utf8"),
        "successful replacement",
      );
      assert.equal(await fs.readFile(source, "utf8"), "failing replacement");
      assert.deepEqual([...(await fs.readdir(root))].sort(), [
        "destination",
        "replacement",
        "source",
      ]);
    });
  });
}

test("concurrent copies through a directory alias preserve the winning destination", async () => {
  await fixture(async (root) => {
    const transfer = createFilesystemTransfer();
    const target = path.join(root, "target");
    const alias = path.join(root, "alias");
    await fs.mkdir(target);
    await fs.symlink(target, alias, "dir");
    const contents = ["first".repeat(100000), "second".repeat(100000)];
    const sources = [path.join(root, "first"), path.join(root, "second")];
    await Promise.all(
      sources.map((source, index) => fs.writeFile(source, contents[index])),
    );
    const destinations = [path.join(target, "file"), path.join(alias, "file")];
    const outcomes = await Promise.allSettled(
      sources.map((source, index) =>
        Effect.runPromise(
          transfer.copy({
            source,
            destination: destinations[index],
            destinationLabel: destinations[index],
            overwrite: false,
            reporter: { update() {} },
          }),
        ),
      ),
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "fulfilled").length,
      1,
    );
    assert.equal(
      outcomes.filter((outcome) => outcome.status === "rejected").length,
      1,
    );
    const winner = outcomes.findIndex(
      (outcome) => outcome.status === "fulfilled",
    );
    assert.equal(await fs.readFile(destinations[0], "utf8"), contents[winner]);
  });
});

test("concurrent overwrite copies publish complete content and remove their backups", async () => {
  await fixture(async (root) => {
    const transfer = createFilesystemTransfer();
    const contents = ["first".repeat(100000), "second".repeat(100000)];
    const sources = [path.join(root, "first"), path.join(root, "second")];
    const destination = path.join(root, "destination");
    await fs.writeFile(destination, "original");
    await Promise.all(
      sources.map((source, index) => fs.writeFile(source, contents[index])),
    );
    await Promise.all(
      sources.map((source) =>
        Effect.runPromise(
          transfer.copy({
            source,
            destination,
            destinationLabel: destination,
            overwrite: true,
            reporter: { update() {} },
          }),
        ),
      ),
    );
    assert.ok(contents.includes(await fs.readFile(destination, "utf8")));
    assert.deepEqual([...(await fs.readdir(root))].sort(), [
      "destination",
      "first",
      "second",
    ]);
  });
});

for (const operation of ["copy", "move"] as const) {
  test(`${operation} preserves file and recursive directory contents`, async () => {
    await fixture(async (root) => {
      const transfer = createFilesystemTransfer();
      for (const kind of ["file", "directory"] as const) {
        const source = path.join(root, kind);
        const destination = path.join(root, "nested", kind);
        const suffix = kind === "directory" ? "/nested/data.txt" : "";
        await fs.mkdir(path.dirname(source + suffix), { recursive: true });
        await fs.writeFile(source + suffix, "preserved contents");
        await Effect.runPromise(
          transfer[operation]({
            source,
            destination,
            destinationLabel: destination,
            overwrite: false,
          }),
        );
        assert.equal(
          await fs.readFile(destination + suffix, "utf8"),
          "preserved contents",
        );
        if (operation === "copy")
          assert.equal(
            await fs.readFile(source + suffix, "utf8"),
            "preserved contents",
          );
        else await assert.rejects(fs.stat(source), { code: "ENOENT" });
      }
    });
  });

  test(`${operation} replaces a directory completely instead of merging it`, async () => {
    await fixture(async (root) => {
      const source = path.join(root, "source");
      const destination = path.join(root, "target");
      await fs.mkdir(path.join(source, "nested"), { recursive: true });
      await fs.mkdir(path.join(destination, "stale"), { recursive: true });
      await fs.writeFile(path.join(source, "nested/new.txt"), "new");
      await fs.writeFile(path.join(destination, "stale/old.txt"), "old");
      await Effect.runPromise(
        createFilesystemTransfer()[operation]({
          source,
          destination,
          destinationLabel: destination,
          overwrite: true,
        }),
      );
      assert.equal(
        await fs.readFile(path.join(destination, "nested/new.txt"), "utf8"),
        "new",
      );
      await assert.rejects(fs.stat(path.join(destination, "stale")), {
        code: "ENOENT",
      });
      assert.equal(
        (await fs.readdir(root)).some((name) =>
          name.includes(".eden-transfer-"),
        ),
        false,
      );
    });
  });

  test(`${operation} rejects same-path and descendant directory destinations without changing the source`, async () => {
    await fixture(async (root) => {
      const source = path.join(root, "tree");
      await fs.mkdir(path.join(source, "child"), { recursive: true });
      await fs.writeFile(path.join(source, "data.txt"), "preserved");
      const transfer = createFilesystemTransfer();
      for (const [destination, error] of [
        [source, /must be different/],
        [path.join(source, "child/nested"), /descendant/],
      ] as const) {
        await assert.rejects(
          Effect.runPromise(
            transfer[operation]({
              source,
              destination,
              destinationLabel: destination,
              overwrite: false,
            }),
          ),
          error,
        );
      }
      assert.equal(
        await fs.readFile(path.join(source, "data.txt"), "utf8"),
        "preserved",
      );
      assert.equal((await fs.readdir(path.join(source, "child"))).length, 0);
    });
  });
}

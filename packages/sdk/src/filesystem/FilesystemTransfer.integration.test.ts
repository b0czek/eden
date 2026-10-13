import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { test as nodeTest } from "node:test";
import { FilesystemTransfer } from "./FilesystemTransfer";

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
      const transfer = new FilesystemTransfer();
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
          transfer[operation]({
            source,
            destination,
            destinationLabel: destination,
            overwrite: false,
            reporter: { update() {} },
          }),
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
      const transfer = new FilesystemTransfer();
      const source = path.join(root, "source");
      const replacement = path.join(root, "replacement");
      const destination = path.join(root, "destination");
      await Promise.all([
        fs.writeFile(source, "failing replacement"),
        fs.writeFile(replacement, "successful replacement"),
        fs.writeFile(destination, "original"),
      ]);
      await assert.rejects(
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
        /source disconnected/,
      );
      assert.equal(await fs.readFile(destination, "utf8"), "original");
      await transfer.copy({
        source: replacement,
        destination,
        destinationLabel: destination,
        overwrite: true,
      });
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
    const transfer = new FilesystemTransfer();
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
        transfer.copy({
          source,
          destination: destinations[index],
          destinationLabel: destinations[index],
          overwrite: false,
          reporter: { update() {} },
        }),
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
    const transfer = new FilesystemTransfer();
    const contents = ["first".repeat(100000), "second".repeat(100000)];
    const sources = [path.join(root, "first"), path.join(root, "second")];
    const destination = path.join(root, "destination");
    await fs.writeFile(destination, "original");
    await Promise.all(
      sources.map((source, index) => fs.writeFile(source, contents[index])),
    );
    await Promise.all(
      sources.map((source) =>
        transfer.copy({
          source,
          destination,
          destinationLabel: destination,
          overwrite: true,
          reporter: { update() {} },
        }),
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

import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { OperationProgress } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { createEffectRuntime } from "../../../tests/support/effect-runtime";
import { fromPromise } from "../../core/effects/io";
import {
  FilesystemAccessDenied,
  type FilesystemTransferError,
  FilesystemTransferIncomplete,
} from "./errors";
import { createFileTransfers } from "./transfers";

it.each(["cancellation", "defect"] as const)(
  "retains original contents and reports incomplete rollback after %s",
  async (failure) => {
    const effects = createEffectRuntime();
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-transfer-recovery-"),
    );
    const source = path.join(directory, "source");
    const destination = path.join(directory, "destination");
    const defect = new Error("Copy progress failed");
    let accessible = true;
    try {
      await fs.writeFile(source, "replacement");
      await fs.writeFile(destination, "original");
      const fiber: Fiber.Fiber<void, FilesystemTransferError> = effects.fork(
        createFileTransfers().copy({
          source,
          destination,
          destinationLabel: "destination",
          overwrite: true,
          assertDestinationActive: () =>
            accessible
              ? Effect.void
              : Effect.fail(
                  new FilesystemAccessDenied({
                    message: "Destination disconnected",
                  }),
                ),
          reporter: {
            commit: Effect.void,
            update(phase) {
              if (phase !== "copying") return;
              accessible = false;
              if (failure === "defect") throw defect;
              fiber.interruptUnsafe();
            },
          },
        }),
      );
      const exit = await effects.run(Fiber.await(fiber));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(
          failure === "cancellation"
            ? Cause.hasInterrupts(exit.cause)
            : Cause.hasDies(exit.cause),
        ).toBe(true);
        const errors = exit.cause.reasons
          .filter(Cause.isFailReason)
          .map((reason) => reason.error);
        expect(errors).toEqual(
          expect.arrayContaining([
            expect.any(FilesystemTransferIncomplete),
            expect.any(FilesystemAccessDenied),
          ]),
        );
      }
      const backup = (await fs.readdir(directory)).find((name) =>
        name.startsWith(".destination.eden-transfer-"),
      );
      assert(backup, "Expected the original destination in a retained backup");
      expect(await fs.readFile(path.join(directory, backup), "utf8")).toBe(
        "original",
      );
      await expect(fs.stat(destination)).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await effects.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

it("reports initial copy progress at clock zero and throttles subsequent progress until time advances", async () => {
  const effects = createEffectRuntime(TestClock.layer());
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-transfer-clock-"),
  );
  const source = path.join(directory, "source");
  const destination = path.join(directory, "destination");
  const size = 3 * 1024 * 1024;
  const updates: OperationProgress[] = [];
  try {
    await fs.writeFile(source, Buffer.alloc(size, 0x5a));
    await effects.run(
      createFileTransfers().copy({
        source,
        destination,
        destinationLabel: "destination",
        overwrite: false,
        reporter: {
          commit: Effect.void,
          update: (phase, progress) => {
            if (phase === "copying" && progress) updates.push(progress);
          },
        },
      }),
    );

    expect(updates[0]).toMatchObject({
      completed: 0,
      total: size,
      unit: "bytes",
    });
    expect(
      updates.filter(({ completed }) => completed > 0 && completed < size),
    ).toHaveLength(1);
    expect(updates.at(-1)).toMatchObject({ completed: size, total: size });
  } finally {
    await effects.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function fixture(run: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-transfer-"));
  try {
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("an interrupted commit restores the overwritten destination", async () => {
  await fixture(async (root) => {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await fs.writeFile(source, "replacement");
    await fs.writeFile(destination, "original");
    const exit = await Effect.runPromiseExit(
      createFileTransfers().copy({
        source,
        destination,
        destinationLabel: destination,
        overwrite: true,
        reporter: { update() {}, commit: Effect.interrupt },
      }),
    );
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
    expect(await fs.readFile(destination, "utf8")).toBe("original");
    expect(await fs.readFile(source, "utf8")).toBe("replacement");
    expect((await fs.readdir(root)).sort()).toEqual(["destination", "source"]);
  });
});

test("a committed rename preserves moved content when the source becomes unavailable", async () => {
  await fixture(async (root) => {
    const source = path.join(root, "source");
    const destination = path.join(root, "destination");
    await fs.writeFile(source, "moved content");
    await fs.writeFile(destination, "old content");
    await Effect.runPromise(
      createFileTransfers().move({
        source,
        destination,
        destinationLabel: destination,
        overwrite: true,
        assertSourceActive: () =>
          fromPromise(() => fs.access(source)).pipe(
            Effect.asVoid,
            Effect.mapError(() => new Error("source disconnected")),
          ),
      }),
    );
    assert.equal(await fs.readFile(destination, "utf8"), "moved content");
    await assert.rejects(fs.stat(source), { code: "ENOENT" });
    assert.deepEqual([...(await fs.readdir(root))], ["destination"]);
  });
});

for (const operation of ["copy", "move"] as const) {
  test(`concurrent ${operation} without overwrite preserves the winning destination`, async () => {
    await fixture(async (root) => {
      const transfer = createFileTransfers();
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
              reporter: { update() {}, commit: Effect.void },
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
      const transfer = createFileTransfers();
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
            assertSourceActive: () =>
              fromPromise(() => fs.stat(destination)).pipe(
                Effect.asVoid,
                Effect.mapError((error) =>
                  (error as NodeJS.ErrnoException).code === "ENOENT"
                    ? new Error("source disconnected")
                    : error,
                ),
              ),
            reporter: { update() {}, commit: Effect.void },
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
    const transfer = createFileTransfers();
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
            reporter: { update() {}, commit: Effect.void },
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
    const transfer = createFileTransfers();
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
            reporter: { update() {}, commit: Effect.void },
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
      const transfer = createFileTransfers();
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
        createFileTransfers()[operation]({
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
      const transfer = createFileTransfers();
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

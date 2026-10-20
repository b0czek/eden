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
import { createEffectRuntime } from "../../tests/support/effect-runtime";
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

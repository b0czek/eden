import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { OperationSnapshot } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { FilesystemAccessDenied } from "../../../src/filesystem/errors";
import { createFileTransfers } from "../../../src/filesystem/transfers";
import type { Operations } from "../../../src/operations/service";
import { operationTask } from "../../../src/operations/task";
import { gate } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

describe("operation completion failures", () => {
  let eden: TestEden;
  let operations: Operations;
  const owner = {
    appId: "completion.app",
    principal: { kind: "system" as const },
  };

  beforeEach(async () => {
    eden = await createTestEden();
    operations = eden.runtime.services.operations;
  });
  afterEach(() => eden.dispose());

  it("exposes incomplete transfer recovery instead of ordinary cancellation", async () => {
    const source = path.join(eden.paths.root, "source");
    const destination = path.join(eden.paths.root, "destination");
    await fs.writeFile(source, "replacement");
    await fs.writeFile(destination, "original");
    let accessible = true;
    const handle = operations.submit("completion/copy", {}, owner, () =>
      operationTask(
        (reporter) =>
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
              update(phase, progress) {
                reporter.update(phase, progress);
                if (phase === "copying") {
                  accessible = false;
                  operations.cancel(handle, owner);
                }
              },
            },
          }),
        { cancellable: true },
      ),
    );
    const exit = await eden.runtime.effects.run(
      Effect.exit(operations.wait(handle, owner)),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    const snapshot = operations.get(handle, owner);
    expect(snapshot).toMatchObject({
      status: "failed",
      error: { name: "AggregateError" },
    });
    if (snapshot.status === "failed") {
      expect(snapshot.error.message).toContain("rollback was incomplete");
      expect(snapshot.error.message).toContain(".destination.eden-transfer-");
    }
  });

  it.each(["session", "runtime"] as const)(
    "settles waiters, publishes failure and releases a %s transition when release throws",
    async (transition) => {
      const finish = gate();
      const defect = new Error("Admission release failed");
      const terminal: OperationSnapshot[] = [];
      operations.changed.on(({ payload: { snapshot }, scope }) => {
        if (scope?.operation?.terminal) terminal.push(snapshot);
      });
      const handle = operations.submit("completion/work", {}, owner, () =>
        operationTask(() => Effect.promise(() => finish.promise), {
          transition,
          release: () => {
            throw defect;
          },
        }),
      );
      const waiting = eden.runtime.effects.run(
        Effect.exit(operations.wait(handle, owner)),
      );
      const draining = eden.runtime.effects.run(operations.drain());
      finish.release();

      const exit = await waiting;
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.findDefect(exit.cause)).toEqual(Result.succeed(defect));
        expect(Cause.hasFails(exit.cause)).toBe(false);
      }
      await draining;
      expect(operations.get(handle, owner)).toMatchObject({
        status: "failed",
        error: { name: "Error", message: "Admission release failed" },
      });
      expect(terminal).toEqual([operations.get(handle, owner)]);

      const next = operations.submit("completion/next", {}, owner, () =>
        operationTask(() => Effect.succeed("done")),
      );
      await expect(
        eden.runtime.effects.run(operations.wait(next, owner)),
      ).resolves.toBe("done");
    },
  );

  it("retains the work failure alongside a release defect", async () => {
    const rejection = new Error("Work failed");
    const defect = new Error("Admission release failed");
    const handle = operations.submit("completion/work", {}, owner, () =>
      operationTask(() => Effect.fail(rejection), {
        release: () => {
          throw defect;
        },
      }),
    );
    const exit = await eden.runtime.effects.run(
      Effect.exit(operations.wait(handle, owner)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.findErrorOption(exit.cause)).toEqual(Option.some(rejection));
      expect(Cause.findDefect(exit.cause)).toEqual(Result.succeed(defect));
    }
    expect(operations.get(handle, owner).status).toBe("failed");
  });

  it("reports failed release during queued cancellation as failure", async () => {
    const defect = new Error("Admission release failed");
    const handle = operations.submit("completion/work", {}, owner, () =>
      operationTask(() => Effect.void, {
        cancellable: true,
        release: () => {
          throw defect;
        },
      }),
    );
    operations.cancel(handle, owner);
    const exit = await eden.runtime.effects.run(
      Effect.exit(operations.wait(handle, owner)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(Cause.findDefect(exit.cause)).toEqual(Result.succeed(defect));
    }
    expect(operations.get(handle, owner)).toMatchObject({
      status: "failed",
      error: { message: "Admission release failed" },
    });
  });

  it("publishes a terminal failure and retains both causes when the encoder throws", async () => {
    const rejection = new Error("Work failed");
    const defect = new TypeError("Failure encoding failed");
    const handle = operations.submit("completion/work", {}, owner, () =>
      operationTask(() => Effect.fail(rejection), {
        encodeFailure: () => {
          throw defect;
        },
      }),
    );
    const exit = await eden.runtime.effects.run(
      Effect.exit(operations.wait(handle, owner)),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.findErrorOption(exit.cause)).toEqual(Option.some(rejection));
      expect(Cause.findDefect(exit.cause)).toEqual(Result.succeed(defect));
    }
    await eden.runtime.effects.run(operations.drain());
    const snapshot = operations.get(handle, owner);
    expect(snapshot).toMatchObject({
      status: "failed",
      error: { name: "TypeError", message: "Failure encoding failed" },
    });
    expect(snapshot).not.toHaveProperty("response");
  });
});

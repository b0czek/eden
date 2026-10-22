import type { OperationHandle } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as v from "valibot";
import {
  defineController,
  operation,
} from "../../../src/core/controllers/controller";
import { gate } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

describe("Effect controller operations", () => {
  let eden: TestEden;
  const owner = {
    appId: "effect-work.app",
    principal: { kind: "system" as const },
  };

  beforeEach(async () => {
    eden = await createTestEden();
    eden.runtime.services.permissions.registerApp(owner.appId, [
      "effect-work/run",
    ]);
  });
  afterEach(async () => eden.dispose());

  it("prepares synchronously and retains Effect execution, progress, caller context and completion", async () => {
    const started = gate();
    const finish = gate();
    const execution = eden.runtime.services.execution;
    const operations = eden.runtime.services.operations;
    const registry = eden.runtime.services.commands;
    registry.registerController(
      defineController("effect-work", {
        commands: {
          run: operation({
            permission: "run",
            input: v.object({ value: v.number() }),
            prepare: ({ value }, caller) => {
              if (value < 0) throw new Error("Value must be nonnegative");
              const appId = caller.appId;
              return (reporter) =>
                Effect.gen(function* () {
                  expect(execution.get()?.appId).toBe(appId);
                  reporter.update("processing");
                  started.release();
                  yield* Effect.promise(() => finish.promise);
                  return { value, appId: execution.get()?.appId };
                });
            },
          }),
        },
      }),
    );
    await expect(
      eden.execute("effect-work/run", { value: -1 }, owner),
    ).rejects.toThrow("Value must be nonnegative");
    expect(operations.list(owner)).toEqual([]);
    const handle = await eden.execute<OperationHandle>(
      "effect-work/run",
      { value: 3 },
      owner,
    );
    expect(operations.get(handle, owner).status).toBe("queued");
    await started.promise;
    try {
      expect(operations.get(handle, owner)).toMatchObject({
        status: "running",
        phase: "processing",
      });
    } finally {
      finish.release();
    }
    await expect(
      eden.runtime.effects.run(operations.wait(handle, owner)),
    ).resolves.toEqual({
      value: 3,
      appId: owner.appId,
    });
    expect(operations.get(handle, owner)).toMatchObject({
      status: "succeeded",
      result: { value: 3, appId: owner.appId },
    });
  });

  it("retains typed Effect failures as failed operations", async () => {
    eden.runtime.services.commands.registerController(
      defineController("effect-work", {
        commands: {
          run: operation({
            permission: "run",
            prepare: () => () => Effect.fail(new Error("Effect work failed")),
          }),
        },
      }),
    );
    const handle = await eden.execute<OperationHandle>(
      "effect-work/run",
      {},
      owner,
    );
    const operations = eden.runtime.services.operations;
    await expect(
      eden.runtime.effects.run(operations.wait(handle, owner)),
    ).rejects.toThrow("Effect work failed");
    expect(operations.get(handle, owner)).toMatchObject({
      status: "failed",
      error: { message: "Effect work failed" },
    });
  });
});

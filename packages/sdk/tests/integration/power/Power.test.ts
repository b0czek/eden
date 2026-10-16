import type { OperationHandle } from "@edenapp/types";
import { operationTask } from "../../../src/operations/task";
import { createTestEden, type TestEden } from "../../support/createTestEden";

describe("power operation lifecycle", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("accepts power before draining, reports handoff, and retains failures for retry", async () => {
    let handoffs = 0;
    eden = await createTestEden({
      config: {
        powerProvider: {
          poweroff: async () => {
            handoffs++;
            if (handoffs === 1) throw new Error("Host refused poweroff");
          },
        },
      },
    });
    const operations = eden.runtime.services.operations;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const work = operations.submit("integration/power-work", {}, {}, () =>
      operationTask(async () => {
        await blocked;
      }),
    );
    const handle = await eden.execute<OperationHandle>("system/power", {
      action: "poweroff",
    });
    expect(operations.get(handle).status).toBe("queued");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(handoffs).toBe(0);
    expect(operations.get(handle).status).toBe("running");
    release();
    await operations.wait(work);
    await expect(operations.wait(handle)).rejects.toThrow(
      "Host refused poweroff",
    );
    expect(operations.get(handle)).toMatchObject({
      status: "failed",
      phase: "host-handoff",
    });
    const retry = await eden.execute<OperationHandle>("system/power", {
      action: "poweroff",
    });
    await expect(operations.wait(retry)).resolves.toBeUndefined();
    expect(operations.get(retry)).toMatchObject({
      status: "succeeded",
      phase: "host-handoff",
    });
    expect(handoffs).toBe(2);
  });

  it("keeps admission closed after a failed handoff until its operation settles", async () => {
    eden = await createTestEden({
      config: {
        powerProvider: {
          poweroff: async () => {
            throw new Error("Host refused poweroff");
          },
        },
      },
    });
    const operations = eden.runtime.services.operations;
    const handle = await eden.execute<OperationHandle>("system/power", {
      action: "poweroff",
    });
    let admissionDuringFailure: Promise<unknown> | undefined;
    const stop = operations.changed.on(({ payload: { snapshot } }) => {
      if (snapshot.id !== handle.id || snapshot.status !== "failed") return;
      admissionDuringFailure = eden
        .execute("system/power", { action: "poweroff" })
        .then(
          () => undefined,
          (error) => error,
        );
    });
    try {
      await expect(operations.wait(handle)).rejects.toThrow(
        "Host refused poweroff",
      );
      expect(admissionDuringFailure).toBeDefined();
      expect(await admissionDuringFailure).toBeInstanceOf(Error);
      expect(((await admissionDuringFailure) as Error).message).toContain(
        "draining",
      );
    } finally {
      stop();
    }
    await expect(eden.complete("session/logout")).resolves.toEqual({
      success: true,
    });
  });
});

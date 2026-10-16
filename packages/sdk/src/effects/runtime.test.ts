import "reflect-metadata";
import * as Effect from "effect/Effect";
import { ExecutionContext } from "../execution/ExecutionContext";
import { createEffectRuntime } from "./runtime";

describe("Effect runtime ownership", () => {
  it("owns acquired resources until disposal and rolls back a failed acquisition", async () => {
    const runtime = createEffectRuntime();
    const released: string[] = [];
    const resource = (name: string) =>
      Effect.acquireRelease(Effect.succeed(name), () =>
        Effect.sync(() => {
          released.push(name);
        }),
      );
    try {
      await expect(runtime.acquire(resource("first"))).resolves.toBe("first");
      const failure = new Error("acquisition failed");
      await expect(
        runtime.acquire(
          Effect.gen(function* () {
            yield* resource("partial");
            return yield* Effect.fail(failure);
          }),
        ),
      ).rejects.toBe(failure);
      expect(released).toEqual(["partial"]);
      await runtime.acquire(resource("second"));
      await runtime.dispose();
      await runtime.dispose();
      expect(released).toEqual(["partial", "second", "first"]);
      await expect(runtime.acquire(resource("late"))).rejects.toThrow(
        "disposed",
      );
      await expect(runtime.run(Effect.succeed("late"))).rejects.toThrow(
        "disposed",
      );
    } finally {
      await runtime.dispose();
    }
  });

  it("awaits active work finalizers before disposing its service resources", async () => {
    const runtime = createEffectRuntime();
    const released: string[] = [];
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    await runtime.acquire(
      Effect.acquireRelease(Effect.void, () =>
        Effect.sync(() => {
          released.push("service");
        }),
      ),
    );
    const running = runtime.run(
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            released.push("work");
          }),
        );
        started();
        yield* Effect.never;
      }).pipe(Effect.scoped),
    );
    const stopped = expect(running).rejects.toBeDefined();
    await ready;
    await runtime.dispose();
    await stopped;
    expect(released).toEqual(["work", "service"]);
  });

  it("keeps legacy caller identity isolated across yielding concurrent work", async () => {
    const runtime = createEffectRuntime();
    const execution = new ExecutionContext({});
    function whoami(appId: string) {
      return execution.run({ appId }, () =>
        runtime.run(
          Effect.gen(function* () {
            const identities: Array<string | undefined> = [];
            for (let index = 0; index < 20; index++) {
              yield* Effect.yieldNow;
              yield* Effect.promise(() => Promise.resolve());
              identities.push(execution.get()?.appId);
            }
            return identities;
          }),
        ),
      );
    }
    try {
      const [first, second] = await Promise.all([
        whoami("first"),
        whoami("second"),
      ]);
      expect(first).toEqual(Array(20).fill("first"));
      expect(second).toEqual(Array(20).fill("second"));
      expect(execution.get()).toBeUndefined();
    } finally {
      await runtime.dispose();
    }
  });
});

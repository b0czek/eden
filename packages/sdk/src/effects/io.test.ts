import * as Cause from "effect/Cause";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { gate, tick } from "../../tests/support/async";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import { fromPromise } from "./io";

class ReadFailed extends Data.TaggedError("ReadFailed")<{
  readonly resource: string;
  readonly cause: unknown;
}> {}

describe("native I/O failure adaptation", () => {
  it.each(["throw", "reject"] as const)(
    "recovers a %s failure by its domain tag while retaining its cause",
    async (mode) => {
      const cause = new Error("device unavailable");
      const read = fromPromise(
        () => {
          if (mode === "throw") throw cause;
          return Promise.reject(cause);
        },
        (cause) => new ReadFailed({ resource: "device", cause }),
      );
      const recovered = await Effect.runPromise(
        read.pipe(Effect.catchTag("ReadFailed", Effect.succeed)),
      );
      expect(recovered).toBeInstanceOf(ReadFailed);
      expect(recovered.resource).toBe("device");
      expect(recovered.cause).toBe(cause);
    },
  );

  it("retains a defect thrown by an error mapper", async () => {
    const defect = new Error("invalid failure mapper");
    const exit = await Effect.runPromiseExit(
      fromPromise(
        () => Promise.reject(new Error("native rejection")),
        () => {
          throw defect;
        },
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toBe(defect);
    }
  });
});

it("aborts native I/O on interruption and waits for it to settle before releasing ownership", async () => {
  const runtime = createEffectRuntime();
  const started = gate();
  const finish = gate();
  let signal: AbortSignal | undefined;
  const fiber = runtime.fork(
    fromPromise((nativeSignal) => {
      signal = nativeSignal;
      started.release();
      return finish.promise;
    }),
  );
  try {
    await started.promise;
    fiber.interruptUnsafe();
    await tick();
    expect(signal?.aborted).toBe(true);
    expect(fiber.pollUnsafe()).toBeUndefined();
    finish.release();
    const exit = await runtime.run(Fiber.await(fiber));
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(
      true,
    );
  } finally {
    finish.release();
    await runtime.dispose();
  }
});

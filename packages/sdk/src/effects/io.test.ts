import * as Cause from "effect/Cause";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { gate, tick } from "../../tests/support/async";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import { fromPromise } from "./io";

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

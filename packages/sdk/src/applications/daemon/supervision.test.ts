import type { DaemonDefinition } from "@edenapp/types";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { createEffectRuntime } from "../../../tests/support/effect-runtime";
import { createDaemonSupervisor, type DaemonState } from "./supervision";

const runtimes: ReturnType<typeof createEffectRuntime>[] = [];

async function fixture({
  policy = "always",
  startupFailure,
  retryInitialFailure = false,
}: {
  policy?: DaemonDefinition["restart"];
  startupFailure?: Error;
  retryInitialFailure?: boolean;
} = {}) {
  const runtime = createEffectRuntime(TestClock.layer());
  runtimes.push(runtime);
  let state: DaemonState = { state: "inactive", restartCount: 0 };
  let launches = 0;
  const supervisor = createDaemonSupervisor({
    clock: await runtime.run(Clock.Clock),
    launch: Effect.suspend(() => {
      launches++;
      return startupFailure ? Effect.fail(startupFailure) : Effect.void;
    }),
    retryInitialFailure,
    isCurrent: () => true,
    restartPolicy: () => policy,
    setState: (next) =>
      Effect.sync(() => {
        state = next;
      }),
  });
  const fiber = runtime.fork(supervisor.run);
  return {
    runtime,
    supervisor,
    fiber,
    ready: () => runtime.run(supervisor.ready),
    exit: (code: number) => runtime.run(supervisor.terminated(code)),
    advance: (milliseconds: number) =>
      runtime.run(TestClock.adjust(Duration.millis(milliseconds))),
    state: () => state,
    launches: () => launches,
  };
}

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
});

it("restarts exited processes with exponential backoff capped at thirty seconds", async () => {
  const daemon = await fixture();
  await daemon.ready();
  expect(daemon.fiber.pollUnsafe()).toBeUndefined();
  let now = 0;
  for (const [index, delay] of [
    1000, 2000, 4000, 8000, 16000, 30000, 30000,
  ].entries()) {
    await daemon.exit(1);
    expect(daemon.state()).toMatchObject({
      state: "backoff",
      restartCount: index + 1,
      nextRestartAt: now + delay,
    });
    await daemon.advance(delay - 1);
    expect(daemon.launches()).toBe(index + 1);
    await daemon.advance(1);
    expect(daemon.launches()).toBe(index + 2);
    expect(daemon.state()).toEqual({
      state: "active",
      restartCount: index + 1,
    });
    now += delay;
  }
});

it("resets the displayed restart count and next backoff after sixty seconds of stable running", async () => {
  const daemon = await fixture();
  await daemon.ready();
  await daemon.exit(1);
  await daemon.advance(1000);
  await daemon.advance(59999);
  expect(daemon.state()).toEqual({ state: "active", restartCount: 1 });
  await daemon.advance(1);
  expect(daemon.state()).toEqual({ state: "active", restartCount: 0 });
  await daemon.exit(1);
  expect(daemon.state()).toMatchObject({
    state: "backoff",
    restartCount: 1,
    nextRestartAt: 62000,
  });
  await daemon.advance(999);
  expect(daemon.launches()).toBe(2);
  await daemon.advance(1);
  expect(daemon.launches()).toBe(3);
});

it.each([
  ["never", 1, "failed"],
  ["on-failure", 0, "inactive"],
  ["on-failure", 1, "backoff"],
  ["always", 0, "backoff"],
] as const)(
  "applies the %s restart policy to exit code %s",
  async (policy, code, state) => {
    const daemon = await fixture({ policy });
    await daemon.ready();
    await daemon.exit(code);
    expect(daemon.state().state).toBe(state);
    expect(daemon.state().lastError).toBe(
      state === "inactive" ? undefined : `Exited with code ${code}`,
    );
    await daemon.advance(1000);
    expect(daemon.launches()).toBe(state === "backoff" ? 2 : 1);
  },
);

it.each([false, true])(
  "retries an initial launch failure only for boot supervision (%s)",
  async (retryInitialFailure) => {
    const failure = new Error("Backend failed to become ready");
    const daemon = await fixture({
      startupFailure: failure,
      retryInitialFailure,
    });
    if (retryInitialFailure) {
      await daemon.ready();
      expect(daemon.state()).toMatchObject({
        state: "backoff",
        restartCount: 1,
      });
    } else {
      await expect(daemon.ready()).rejects.toBe(failure);
      expect(daemon.state()).toMatchObject({
        state: "failed",
        lastError: failure.message,
      });
    }
    await daemon.advance(1000);
    expect(daemon.launches()).toBe(retryInitialFailure ? 2 : 1);
  },
);

it("keeps a delayed exit notification attached to the process attempt that emitted it", async () => {
  const daemon = await fixture();
  await daemon.ready();
  const delayedExit = daemon.supervisor.terminated(1);
  await daemon.exit(1);
  await daemon.advance(1000);
  await daemon.runtime.run(delayedExit);
  expect(daemon.state()).toEqual({ state: "active", restartCount: 1 });
  await daemon.advance(2000);
  expect(daemon.launches()).toBe(2);
});

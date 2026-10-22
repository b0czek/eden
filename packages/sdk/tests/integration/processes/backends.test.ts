import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scheduler from "effect/Scheduler";
import * as TestClock from "effect/testing/TestClock";
import { DlcResources } from "../../../src/applications/packages/dlc-resources";
import {
  Backends,
  BackendsLive,
} from "../../../src/applications/processes/backends";
import { BackendIoFailed } from "../../../src/applications/processes/errors";
import { UtilityProcessPort } from "../../../src/platform/ports/types";
import { DistPath } from "../../../src/runtime/inputs";
import { testApp } from "../../support/apps";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";
import { InMemoryPlatform } from "../../support/in-memory-platform";

describe("backend readiness and termination", () => {
  let effects: ReturnType<typeof createEffectRuntime>;
  let platform: InMemoryPlatform;
  let backends: Backends;
  const appId = "com.example.backend";

  beforeEach(async () => {
    effects = createEffectRuntime(TestClock.layer());
    platform = new InMemoryPlatform("/tmp/eden-backend-waits");
    backends = await effects.acquire(
      buildService(Backends, BackendsLive).pipe(
        Effect.provideService(DistPath, "/dist"),
        Effect.provideService(UtilityProcessPort, platform.utilityProcesses),
        Effect.provideService(DlcResources, {
          list: () => [],
          createBackendBinding: () => ({ capability: "token", roots: {} }),
          revokeBackend: () => {},
        }),
      ),
    );
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const id of backends.getRunningBackends())
      backends.getBackend(id)?.kill();
    await effects.dispose();
  });

  async function start(id = appId) {
    const spawned =
      Deferred.makeUnsafe<ReturnType<typeof platform.utilityProcesses.fork>>();
    const original = platform.utilityProcesses.fork.bind(
      platform.utilityProcesses,
    );
    const fork = jest
      .spyOn(platform.utilityProcesses, "fork")
      .mockImplementation((...args) => {
        const backend = original(...args);
        Deferred.doneUnsafe(spawned, Effect.succeed(backend));
        return backend;
      });
    const starting = effects.acquire(
      backends.createBackend(
        id,
        testApp(id, {
          frontend: undefined,
          backend: { entry: "backend.js" },
        }),
        "/app",
      ),
    );
    await effects.run(Deferred.await(spawned));
    fork.mockRestore();
    await effects.run(TestClock.adjust(Duration.zero));
    const pid = backends.getBackend(id)?.pid;
    if (pid === undefined) throw new Error("Backend was not started");
    const backend = platform.utilityProcesses.get(pid);
    if (!backend) throw new Error("Native backend was not started");
    return { starting, backend };
  }

  it("terminates every running backend through bulk shutdown", async () => {
    for (const id of [appId, "com.example.second-backend"]) {
      const { starting, backend } = await start(id);
      backend.emit("message", { type: "backend-ready" });
      await starting;
    }
    const stopping = effects.run(backends.terminateAll());
    await effects.run(TestClock.adjust(Duration.millis(500)));
    await stopping;
    expect(backends.getRunningBackends()).toEqual([]);
    expect(platform.utilityProcesses.activeCount).toBe(0);
  });

  it("kills a backend that never becomes ready and releases its admission", async () => {
    const { starting, backend } = await start();
    const rejected = expect(starting).rejects.toThrow(
      "startup timed out after 10 seconds",
    );
    await effects.run(TestClock.adjust(Duration.millis(9999)));
    expect(backends.hasBackend(appId)).toBe(true);
    await effects.run(TestClock.adjust(Duration.millis(1)));
    await rejected;
    expect(platform.utilityProcesses.activeCount).toBe(0);
    expect(backends.hasBackend(appId)).toBe(false);
    expect(backend.listenerCount("message")).toBe(0);
  });

  it.each([false, true])(
    "force-kills only when graceful shutdown has not exited (graceful=%s)",
    async (graceful) => {
      const { starting, backend } = await start();
      backend.emit("message", { type: "backend-ready" });
      await starting;
      const kill = jest.spyOn(backend, "kill");
      const stopping = effects.run(backends.terminateBackend(appId));
      await effects.run(TestClock.adjust(Duration.zero));
      expect(backend.messages).toContainEqual({ type: "shutdown" });
      if (graceful) backend.emit("exit", 0);
      await effects.run(TestClock.adjust(Duration.millis(499)));
      expect(kill).not.toHaveBeenCalled();
      await effects.run(TestClock.adjust(Duration.millis(1)));
      await stopping;
      expect(kill).toHaveBeenCalledTimes(graceful ? 0 : 1);
      expect(backends.hasBackend(appId)).toBe(false);
      // Clean up the native test process after a simulated graceful exit.
      if (graceful) backend.kill();
    },
  );

  it("kills the owned backend when its shutdown channel fails", async () => {
    const { starting, backend } = await start();
    backend.emit("message", { type: "backend-ready" });
    await starting;
    jest.spyOn(backend, "postMessage").mockImplementation(() => {
      throw new Error("closed channel");
    });
    await expect(effects.run(backends.terminateBackend(appId))).rejects.toThrow(
      "closed channel",
    );
    await effects.run(TestClock.adjust(Duration.millis(500)));
    expect(platform.utilityProcesses.activeCount).toBe(0);
    expect(backends.hasBackend(appId)).toBe(false);
    backend.kill();
  });

  it("settles termination when the backend exits during scheduler setup", async () => {
    const { starting, backend } = await start();
    backend.emit("message", { type: "backend-ready" });
    await starting;
    const scheduler = await effects.run(Scheduler.Scheduler);
    const exited = Deferred.makeUnsafe<void>();
    let queued = false;
    let yielded = false;
    const exitDuringSetup: Scheduler.Scheduler = {
      executionMode: scheduler.executionMode,
      makeDispatcher() {
        const dispatcher = scheduler.makeDispatcher();
        return {
          scheduleTask(task, priority) {
            queued = true;
            dispatcher.scheduleTask(task, priority);
          },
          flush: () => dispatcher.flush(),
        };
      },
      shouldYield(fiber) {
        if (queued && !yielded) {
          yielded = true;
          // Native exit can arrive while the terminating fiber is yielded.
          queueMicrotask(() => {
            backend.kill();
            Deferred.doneUnsafe(exited, Effect.void);
          });
          return true;
        }
        return scheduler.shouldYield(fiber);
      },
    };
    const stopping = effects.fork(
      backends
        .terminateBackend(appId)
        .pipe(Effect.provideService(Scheduler.Scheduler, exitDuringSetup)),
    );
    await effects.run(Deferred.await(exited));
    await effects.run(TestClock.adjust(Duration.seconds(5)));
    expect(await effects.run(Fiber.await(stopping))).toEqual(Exit.void);
    expect(yielded).toBe(true);
    expect(backends.hasBackend(appId)).toBe(false);
    expect(platform.utilityProcesses.activeCount).toBe(0);
    expect(backend.listenerCount("exit")).toBe(0);
  });

  it("retains backend ownership until native exit when termination is interrupted", async () => {
    const { starting, backend } = await start();
    backend.emit("message", { type: "backend-ready" });
    await starting;
    const stopping = effects.fork(backends.terminateBackend(appId));
    await effects.run(TestClock.adjust(Duration.zero));
    stopping.interruptUnsafe();
    await effects.run(TestClock.adjust(Duration.millis(499)));
    expect(backends.getBackend(appId)).toBe(backend);
    expect(platform.utilityProcesses.activeCount).toBe(1);
    expect(stopping.pollUnsafe()).toBeUndefined();
    await effects.run(TestClock.adjust(Duration.millis(1)));
    const exit = await effects.run(Fiber.await(stopping));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(backends.hasBackend(appId)).toBe(false);
    expect(platform.utilityProcesses.activeCount).toBe(0);
  });

  it("waits for killed process exit before reporting a shutdown channel failure", async () => {
    const { starting, backend } = await start();
    backend.emit("message", { type: "backend-ready" });
    await starting;
    const failure = new Error("closed channel");
    jest.spyOn(backend, "postMessage").mockImplementation(() => {
      throw failure;
    });
    const kill = jest.spyOn(backend, "kill").mockReturnValue(true);
    const stopping = effects.fork(backends.terminateBackend(appId));
    await effects.run(TestClock.adjust(Duration.zero));
    expect(backends.getBackend(appId)).toBe(backend);
    expect(stopping.pollUnsafe()).toBeUndefined();
    backend.emit("exit", 0);
    const exit = await effects.run(Fiber.await(stopping));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(BackendIoFailed);
      if (!(error instanceof BackendIoFailed))
        throw new Error("Expected backend I/O failure");
      expect(error.cause).toBe(failure);
    }
    expect(backends.hasBackend(appId)).toBe(false);
    kill.mockRestore();
    backend.kill();
  });

  it("fails termination if the native process never reports exit", async () => {
    const { starting, backend } = await start();
    backend.emit("message", { type: "backend-ready" });
    await starting;
    jest.spyOn(backend, "kill").mockReturnValue(false);
    const rejected = expect(
      effects.run(backends.terminateBackend(appId)),
    ).rejects.toThrow("termination timed out after 5 seconds");
    await effects.run(TestClock.adjust(Duration.millis(4999)));
    expect(backends.hasBackend(appId)).toBe(true);
    await effects.run(TestClock.adjust(Duration.millis(1)));
    await rejected;
    expect(backends.hasBackend(appId)).toBe(false);
    jest.restoreAllMocks();
    backend.kill();
  });
});

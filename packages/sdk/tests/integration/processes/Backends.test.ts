import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { type Backends, createBackends } from "../../../src/processes/backends";
import { testApp } from "../../support/apps";
import { createEffectRuntime } from "../../support/effect-runtime";
import { InMemoryPlatform } from "../../support/InMemoryPlatform";

describe("backend readiness and termination", () => {
  let effects: ReturnType<typeof createEffectRuntime>;
  let platform: InMemoryPlatform;
  let backends: Backends;
  const appId = "com.example.backend";

  beforeEach(async () => {
    effects = createEffectRuntime(TestClock.layer());
    platform = new InMemoryPlatform("/tmp/eden-backend-waits");
    backends = await effects.acquire(
      createBackends({
        distPath: "/dist",
        utilityProcesses: platform.utilityProcesses,
        dlcResources: {
          createBackendBinding: () => ({ capability: "token", roots: {} }),
          revokeBackend: () => {},
        },
      }),
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
    expect(backend.listenerCount("exit")).toBe(1); // Only the process lifecycle listener remains.
    jest.restoreAllMocks();
    backend.kill();
  });
});

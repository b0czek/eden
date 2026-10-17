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
    effects = createEffectRuntime();
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
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "setImmediate"] });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await effects.dispose();
    jest.useRealTimers();
  });

  async function start() {
    const starting = effects.run(
      backends.createBackend(
        appId,
        testApp(appId, {
          frontend: undefined,
          backend: { entry: "backend.js" },
        }),
        "/app",
      ),
    );
    await jest.advanceTimersByTimeAsync(0);
    const pid = backends.getBackend(appId)?.pid;
    if (pid === undefined) throw new Error("Backend was not started");
    const backend = platform.utilityProcesses.get(pid);
    if (!backend) throw new Error("Native backend was not started");
    return { starting, backend };
  }

  it("kills a backend that never becomes ready and releases its admission", async () => {
    const { starting, backend } = await start();
    const rejected = expect(starting).rejects.toThrow(
      "startup timed out after 10 seconds",
    );
    await jest.advanceTimersByTimeAsync(10_000);
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
      await jest.advanceTimersByTimeAsync(0);
      expect(backend.messages).toContainEqual({ type: "shutdown" });
      if (graceful) backend.emit("exit", 0);
      await jest.advanceTimersByTimeAsync(500);
      await stopping;
      expect(kill).toHaveBeenCalledTimes(graceful ? 0 : 1);
      expect(backends.hasBackend(appId)).toBe(false);
      // Clean up the native test process after a simulated graceful exit.
      if (graceful) backend.kill();
    },
  );

  it("cleans up a failed shutdown request and cancels the force-kill", async () => {
    const { starting, backend } = await start();
    backend.emit("message", { type: "backend-ready" });
    await starting;
    jest.spyOn(backend, "postMessage").mockImplementation(() => {
      throw new Error("closed channel");
    });
    const kill = jest.spyOn(backend, "kill");
    await expect(effects.run(backends.terminateBackend(appId))).rejects.toThrow(
      "closed channel",
    );
    await jest.advanceTimersByTimeAsync(500);
    expect(kill).not.toHaveBeenCalled();
    expect(backend.listenerCount("exit")).toBe(1);
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
    await jest.advanceTimersByTimeAsync(5_000);
    await rejected;
    expect(backends.hasBackend(appId)).toBe(false);
    expect(backend.listenerCount("exit")).toBe(1); // Only the process lifecycle listener remains.
    jest.restoreAllMocks();
    backend.kill();
  });
});

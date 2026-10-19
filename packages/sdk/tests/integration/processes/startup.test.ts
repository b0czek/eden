import type { UserProfile } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import type { WindowingPort } from "../../../src/platform/ports";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/createTestEden";

describe("app instance ownership", () => {
  const appId = "com.example.owned-launch";
  let eden: TestEden;
  let profile: UserProfile;
  beforeEach(async () => {
    eden = await createTestEden();
    profile = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "operator",
        name: "Operator",
        password: "password",
        grants: ["*"],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(profile.username, "password"),
    );
    eden.runtime.services.installedPackages.register(
      testApp(appId, { backend: { entry: "backend.js" } }),
    );
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await eden.dispose();
  });
  function launch() {
    const { execution, processes } = eden.runtime.services;
    return execution.provide(processes.launchApp(appId), {
      principal: { kind: "user", profile },
    });
  }
  async function backend() {
    await tick();
    const pid = eden.runtime.services.backends.getBackend(appId)?.pid;
    const native =
      pid === undefined ? undefined : eden.platform.utilityProcesses.get(pid);
    if (!native) throw new Error("Backend did not start");
    return native;
  }

  it("cleans up an exited app while another app's uninstall cleanup is pending", async () => {
    const {
      backends,
      execution,
      processes,
      packages,
      installedPackages,
      runtimeContexts,
    } = eden.runtime.services;
    const closing = gate();
    const finish = gate();
    const exited = gate();
    const create = backends.createBackend;
    const pause = jest
      .spyOn(backends, "createBackend")
      .mockImplementation((...args) =>
        Effect.gen(function* () {
          const result = yield* create(...args);
          yield* Effect.addFinalizer(() =>
            Effect.promise(() => {
              closing.release();
              return finish.promise;
            }),
          );
          return result;
        }),
      );
    const secondId = "com.example.independent-exit";
    const off = processes.exited.on(({ appId: id }) => {
      if (id === secondId) exited.release();
    });
    try {
      const first = eden.runtime.effects.run(launch());
      (await backend()).emit("message", { type: "backend-ready" });
      await first;
      pause.mockRestore();
      installedPackages.register(
        testApp(secondId, { backend: { entry: "backend.js" } }),
      );
      const second = eden.runtime.effects.run(
        execution.provide(processes.launchApp(secondId), {
          principal: { kind: "user", profile },
        }),
      );
      await tick();
      const native = backends.getBackend(secondId);
      if (!native?.pid) throw new Error("Second backend did not start");
      const secondBackend = eden.platform.utilityProcesses.get(native.pid);
      if (!secondBackend)
        throw new Error("Second native backend did not start");
      secondBackend.emit("message", { type: "backend-ready" });
      await second;

      packages.uninstalled.emit({ kind: "app", packageId: appId });
      await closing.promise;
      secondBackend.kill();
      await exited.promise;
      expect(processes.getAppInstance(secondId)).toBeUndefined();
      expect(runtimeContexts.get(secondId)).toBeUndefined();
    } finally {
      finish.release();
      pause.mockRestore();
      off();
    }
  });

  it("releases a ready backend, partially configured view, and identity when frontend setup fails", async () => {
    const baseline = eden.platform.activeResourceCount;
    const failure = new Error("Frontend logger unavailable");
    const windows: WindowingPort = eden.platform.windows;
    const attach = windows.attachWebContentsLogger;
    const broken = jest
      .spyOn(windows, "attachWebContentsLogger")
      .mockImplementation((contents, context) => {
        if (context.appId === appId) throw failure;
        return attach(contents, context);
      });
    const starting = eden.runtime.effects
      .run(launch())
      .catch((error: unknown) => error);
    (await backend()).emit("message", { type: "backend-ready" });
    expect(await starting).toBe(failure);
    expect(eden.platform.utilityProcesses.activeCount).toBe(0);
    expect(eden.platform.activeResourceCount).toBe(baseline);
    expect(
      eden.runtime.services.processes.getAppInstance(appId),
    ).toBeUndefined();
    expect(eden.runtime.services.runtimeContexts.get(appId)).toBeUndefined();
    broken.mockRestore();
    const retry = eden.runtime.effects.run(launch());
    (await backend()).emit("message", { type: "backend-ready" });
    await expect(retry).resolves.toMatchObject({ success: true });
  });

  it("serializes overlapping launches without replacing or unregistering the admitted identity", async () => {
    const first = eden.runtime.effects.run(launch());
    const native = await backend();
    const identity = eden.runtime.services.runtimeContexts.get(appId);
    expect(identity).toBeDefined();
    const second = eden.runtime.effects
      .run(launch())
      .catch((error: unknown) => error);
    await tick();
    native.emit("message", { type: "backend-ready" });
    await expect(first).resolves.toMatchObject({ success: true });
    expect(await second).toEqual(
      expect.objectContaining({ message: `App ${appId} is already running` }),
    );
    expect(eden.runtime.services.runtimeContexts.get(appId)).toBe(identity);
    expect(
      eden.runtime.services.runtimeContexts.resolvePrincipal(appId),
    ).toMatchObject({ kind: "user", profile: { username: "operator" } });
    expect(eden.platform.utilityProcesses.activeCount).toBe(1);
    expect(
      eden.platform.effects.filter(
        (effect) => effect.type === "utility-process-started",
      ),
    ).toHaveLength(1);
  });

  it("releases an interrupted startup before admitting a replacement", async () => {
    const first = eden.runtime.effects.fork(launch());
    await backend();
    await Effect.runPromise(Fiber.interrupt(first));
    expect(eden.runtime.services.runtimeContexts.get(appId)).toBeUndefined();
    expect(eden.platform.utilityProcesses.activeCount).toBe(0);
    const retry = eden.runtime.effects.run(launch());
    (await backend()).emit("message", { type: "backend-ready" });
    await expect(retry).resolves.toMatchObject({ success: true });
  });

  it("releases the exited instance and ignores an old backend's delayed exit after replacement", async () => {
    const first = eden.runtime.effects.run(launch());
    const old = await backend();
    old.emit("message", { type: "backend-ready" });
    await first;
    const instance = eden.runtime.services.processes.getAppInstance(appId);
    if (!instance) throw new Error("App instance was not published");
    const view = eden.runtime.services.views.getViewInfo(instance.viewId)?.view;
    if (!view) throw new Error("App view was not published");
    const exited = gate<void>();
    const stop = eden.runtime.services.processes.exited.on(() =>
      exited.release(),
    );
    const oldExit = old.listeners("exit");
    old.kill();
    await exited.promise;
    stop();
    expect(view.webContents.isDestroyed()).toBe(true);
    expect(eden.runtime.services.runtimeContexts.get(appId)).toBeUndefined();
    const replacing = eden.runtime.effects.run(launch());
    const replacement = await backend();
    replacement.emit("message", { type: "backend-ready" });
    await replacing;
    const identity = eden.runtime.services.runtimeContexts.get(appId);
    for (const listener of oldExit) listener(1);
    await tick();
    expect(eden.runtime.services.backends.getBackend(appId)).toBe(replacement);
    expect(eden.runtime.services.runtimeContexts.get(appId)).toBe(identity);
    expect(
      eden.runtime.services.processes.getAppInstance(appId)?.instanceId,
    ).not.toBe(instance.instanceId);
    expect(eden.platform.utilityProcesses.activeCount).toBe(1);
  });
});

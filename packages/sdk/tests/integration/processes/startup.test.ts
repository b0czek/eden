import type { SystemInfo, UserProfile } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scheduler from "effect/Scheduler";
import * as TestClock from "effect/testing/TestClock";
import { ProcessStopFailed } from "../../../src/applications/processes/errors";
import { ViewNativeFailure } from "../../../src/desktop/views/errors";
import { log } from "../../../src/platform/logging/logger";
import type { WindowingPort } from "../../../src/platform/ports/types";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/create-test-eden";
import { createEffectRuntime } from "../../support/effect-runtime";
import type { InMemoryUtilityProcess } from "../../support/in-memory-platform";

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
    return eden.getBackendProcess(appId);
  }

  it.each(["frontend", "backend"] as const)(
    "reports published instances directly in system info (%s)",
    async (kind) => {
      const { installedPackages, processes } = eden.runtime.services;
      installedPackages.register(
        testApp(appId, {
          frontend: kind === "frontend" ? { entry: "index.html" } : undefined,
          backend: { entry: "backend.js" },
        }),
      );
      const starting = eden.runtime.effects.run(launch());
      const native = await backend();
      expect(
        (await eden.execute<SystemInfo>("system/info")).runningApps,
      ).not.toContain(appId);
      native.emit("message", { type: "backend-ready" });
      await starting;
      expect(
        (await eden.execute<SystemInfo>("system/info")).runningApps,
      ).toContain(appId);
      const exited = gate();
      const off = processes.exited.on(() => exited.release());
      try {
        native.kill();
        await exited.promise;
        expect(
          (await eden.execute<SystemInfo>("system/info")).runningApps,
        ).not.toContain(appId);
      } finally {
        off();
      }
    },
  );

  it("rejects an exit before publication and releases the partial view and identity", async () => {
    const { processes, views, backends, runtimeContexts } =
      eden.runtime.services;
    const baseline = eden.platform.activeResourceCount;
    const scheduler = await eden.runtime.effects.run(Scheduler.Scheduler);
    const validation = jest.spyOn(backends, "getBackend");
    const published: unknown[] = [];
    const off = processes.launched.on((event) => {
      published.push(event);
    });
    let native: InMemoryUtilityProcess | undefined;
    let yielded = false;
    const exitBeforeValidation: Scheduler.Scheduler = {
      executionMode: scheduler.executionMode,
      makeDispatcher: () => scheduler.makeDispatcher(),
      shouldYield(fiber) {
        if (native && !yielded && views.getViewsByAppId(appId).length > 0) {
          yielded = true;
          // Frontend acquisition has begun, but the final check has not run.
          expect(validation).not.toHaveBeenCalled();
          queueMicrotask(() => native?.kill());
          return true;
        }
        return scheduler.shouldYield(fiber);
      },
    };
    try {
      const starting = eden.runtime.effects.run(
        Effect.exit(
          launch().pipe(
            Effect.provideService(Scheduler.Scheduler, exitBeforeValidation),
          ),
        ),
      );
      native = await backend();
      validation.mockClear();
      native.emit("message", { type: "backend-ready" });
      const exit = await starting;
      expect(yielded).toBe(true);
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("Expected startup failure");
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(Cause.squash(exit.cause)).toMatchObject({
        _tag: "BackendStartupFailed",
        appId,
        reason: "exited",
      });
      expect(published).toEqual([]);
      expect(processes.getAppInstance(appId)).toBeUndefined();
      expect(runtimeContexts.get(appId)).toBeUndefined();
      expect(backends.hasBackend(appId)).toBe(false);
      expect(backends.getFrontendPort(appId)).toBeUndefined();
      expect(views.getViewsByAppId(appId)).toEqual([]);
      expect(eden.platform.activeResourceCount).toBe(baseline);
      const retry = eden.runtime.effects.run(launch());
      (await backend()).emit("message", { type: "backend-ready" });
      await expect(retry).resolves.toMatchObject({ success: true });
    } finally {
      off();
      validation.mockRestore();
    }
  });

  it.each(["frontend", "backend", "daemon"] as const)(
    "retains an exit at the first scheduler boundary after liveness validation (%s)",
    async (kind) => {
      const {
        processes,
        backends,
        runtimeContexts,
        installedPackages,
        daemons,
      } = eden.runtime.services;
      installedPackages.register(
        testApp(appId, {
          frontend: kind === "frontend" ? { entry: "index.html" } : undefined,
          backend: { entry: "backend.js" },
        }),
      );
      if (kind === "daemon")
        await eden.runtime.effects.run(
          daemons.updateDefinition({
            appId,
            enabled: false,
            runAs: { kind: "user", username: profile.username },
            restart: "always",
          }),
        );
      const effects = createEffectRuntime(TestClock.layer());
      const scheduler = await effects.run(Scheduler.Scheduler);
      // Observe the real lookup without replacing any service behavior.
      const validation = jest.spyOn(backends, "getBackend");
      const natives: InMemoryUtilityProcess[] = [];
      const fork = eden.platform.utilityProcesses.fork.bind(
        eden.platform.utilityProcesses,
      );
      const spawn = jest
        .spyOn(eden.platform.utilityProcesses, "fork")
        .mockImplementation((...args) => {
          const process = fork(...args);
          const native = eden.platform.utilityProcesses.get(process.pid ?? -1);
          if (!native) throw new Error("Native backend was not started");
          natives.push(native);
          queueMicrotask(() =>
            native.emit("message", { type: "backend-ready" }),
          );
          return native;
        });
      const backoff = gate();
      const delivered = gate();
      const activeReplacement = gate();
      const secondBackoff = gate();
      const offStatus = daemons.changed.on(({ status }) => {
        if (status.appId !== appId) return;
        if (status.state === "backoff") {
          if (status.restartCount === 1) backoff.release();
          if (status.restartCount === 2) secondBackoff.release();
        }
        if (status.state === "active" && natives.length === 2)
          activeReplacement.release();
      });
      const notifications: unknown[] = [];
      const offExit = processes.exited.on(({ appId: id, code }) => {
        if (id === appId)
          notifications.push({
            code,
            instance: processes.getAppInstance(appId),
            identity: runtimeContexts.get(appId),
          });
      });
      let yielded = false;
      const exitAfterValidation: Scheduler.Scheduler = {
        executionMode: scheduler.executionMode,
        makeDispatcher: () => scheduler.makeDispatcher(),
        shouldYield(fiber) {
          if (!yielded && validation.mock.results.some((call) => call.value)) {
            yielded = true;
            queueMicrotask(() => {
              natives[0]?.kill();
              delivered.release();
            });
            return true;
          }
          return scheduler.shouldYield(fiber);
        },
      };
      try {
        const starting = kind === "daemon" ? daemons.start(appId) : launch();
        await effects.run(
          starting.pipe(
            Effect.provideService(Scheduler.Scheduler, exitAfterValidation),
          ),
        );
        expect(yielded).toBe(true);
        await delivered.promise;
        await tick();
        // Join admission behind the exit task, including all scope finalizers.
        await expect(
          effects.run(processes.stopApp(appId)),
        ).rejects.toMatchObject({
          _tag: "ProcessNotRunning",
        });
        expect(processes.getAppInstance(appId)).toBeUndefined();
        expect(runtimeContexts.get(appId)).toBeUndefined();
        expect(backends.hasBackend(appId)).toBe(false);
        expect(backends.getFrontendPort(appId)).toBeUndefined();
        expect(eden.platform.utilityProcesses.activeCount).toBe(0);
        expect(notifications).toEqual([
          { code: 0, instance: undefined, identity: undefined },
        ]);

        if (kind === "daemon") {
          await backoff.promise;
          await effects.run(TestClock.adjust(Duration.seconds(1)));
          await activeReplacement.promise;
        } else {
          await effects.run(launch());
        }
        expect(natives).toHaveLength(2);
        expect(processes.getAppInstance(appId)).toBeDefined();
        expect(runtimeContexts.get(appId)).toBeDefined();
        expect(backends.getBackend(appId)).toBe(natives[1]);
        // The same ownership handoff must still handle a normal later exit.
        natives[1]?.kill();
        await tick();
        await expect(
          effects.run(processes.stopApp(appId)),
        ).rejects.toMatchObject({
          _tag: "ProcessNotRunning",
        });
        expect(notifications).toHaveLength(2);
        expect(runtimeContexts.get(appId)).toBeUndefined();
        expect(eden.platform.utilityProcesses.activeCount).toBe(0);
        if (kind === "daemon") {
          await secondBackoff.promise;
          await effects.run(daemons.stop(appId));
          expect((await effects.run(daemons.list()))[0]).toMatchObject({
            state: "inactive",
          });
        }
      } finally {
        validation.mockRestore();
        spawn.mockRestore();
        offExit();
        offStatus();
        if (kind === "daemon") await effects.run(daemons.stop(appId));
        await effects.dispose();
      }
    },
  );

  it.each(["exit", "stop"] as const)(
    "publishes %s after removing an instance even when native view cleanup fails",
    async (reason) => {
      const starting = eden.runtime.effects.run(launch());
      const native = await backend();
      native.emit("message", { type: "backend-ready" });
      await starting;
      const { processes, views, runtimeContexts } = eden.runtime.services;
      const view = eden.getAppView(appId);
      const failure = new Error("Native close failed");
      const close = jest
        .spyOn(view.view.webContents, "close")
        .mockImplementation(() => {
          throw failure;
        });
      const errors = jest.spyOn(log, "error");
      const notifications: unknown[] = [];
      const record = (event: "exit" | "stop") => {
        notifications.push({
          event,
          instance: processes.getAppInstance(appId),
          context: runtimeContexts.get(appId),
          view: views.getViewInfo(view.id),
        });
      };
      const offExited = processes.exited.on(({ appId: id }) => {
        if (id === appId) record("exit");
      });
      const offStopped = processes.stopped.on(({ appId: id }) => {
        if (id === appId) record("stop");
      });
      try {
        if (reason === "exit") {
          native.kill();
          await tick();
          // Joining admission waits for the exit cleanup to release the app lock.
          await expect(
            eden.runtime.effects.run(processes.stopApp(appId)),
          ).rejects.toMatchObject({ _tag: "ProcessNotRunning" });
        } else {
          const exit = await eden.runtime.effects.run(
            Effect.exit(processes.stopApp(appId)),
          );
          expect(Exit.isFailure(exit)).toBe(true);
          if (Exit.isFailure(exit)) {
            expect(Cause.hasDies(exit.cause)).toBe(false);
            const error = Cause.squash(exit.cause);
            expect(error).toBeInstanceOf(ProcessStopFailed);
            if (!(error instanceof ProcessStopFailed))
              throw new Error("Expected process stop failure");
            expect(Cause.squash(error.cause)).toMatchObject({
              _tag: "ViewNativeFailure",
              cause: failure,
            });
          }
        }
        expect(notifications).toEqual([
          {
            event: reason,
            instance: undefined,
            context: undefined,
            view: undefined,
          },
        ]);
        expect(errors).toHaveBeenCalledWith(
          reason === "exit"
            ? "Process lifecycle task failed:"
            : `Failed to stop app ${appId}:`,
          expect.objectContaining({ _tag: "ProcessStopFailed" }),
        );
      } finally {
        offExited();
        offStopped();
        close.mockRestore();
        view.view.webContents.close();
      }
    },
  );

  it("retains view and backend cleanup failures while releasing instance ownership", async () => {
    const starting = eden.runtime.effects.run(launch());
    const native = await backend();
    native.emit("message", { type: "backend-ready" });
    await starting;
    const { processes, views, backends, runtimeContexts } =
      eden.runtime.services;
    const view = eden.getAppView(appId);
    const closeFailure = new Error("Native close failed");
    const shutdownFailure = new Error("Backend shutdown channel failed");
    const close = jest
      .spyOn(view.view.webContents, "close")
      .mockImplementation(() => {
        throw closeFailure;
      });
    const postMessage = native.postMessage.bind(native);
    const shutdown = jest
      .spyOn(native, "postMessage")
      .mockImplementation((message) => {
        if ((message as { type: string }).type === "shutdown")
          throw shutdownFailure;
        return postMessage(message);
      });
    try {
      const exit = await eden.runtime.effects.run(
        Effect.exit(processes.stopApp(appId)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (!Exit.isFailure(exit)) throw new Error("Expected cleanup failure");
      expect(Cause.hasDies(exit.cause)).toBe(false);
      expect(exit.cause.reasons).toHaveLength(1);
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(ProcessStopFailed);
      if (!(error instanceof ProcessStopFailed))
        throw new Error("Expected process stop failure");
      const failures = error.cause.reasons.flatMap((reason) =>
        Cause.isDieReason(reason) ? [reason.defect] : [],
      );
      expect(failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _tag: "ViewNativeFailure",
            cause: closeFailure,
          }),
          expect.objectContaining({
            _tag: "BackendIoFailed",
            cause: shutdownFailure,
          }),
        ]),
      );
      expect(processes.getAppInstance(appId)).toBeUndefined();
      expect(runtimeContexts.get(appId)).toBeUndefined();
      expect(views.getViewInfo(view.id)).toBeUndefined();
      expect(backends.hasBackend(appId)).toBe(false);
      expect(eden.platform.utilityProcesses.activeCount).toBe(0);
    } finally {
      shutdown.mockRestore();
      close.mockRestore();
      view.view.webContents.close();
    }
  });

  it("releases the instance's backend, view, and identity during runtime disposal", async () => {
    const starting = eden.runtime.effects.run(launch());
    const native = await backend();
    native.emit("message", { type: "backend-ready" });
    await starting;
    const { processes, views, backends, runtimeContexts } =
      eden.runtime.services;
    const view = eden.getAppView(appId);
    const notifications: string[] = [];
    const off = processes.stopped.on(({ appId }) => {
      notifications.push(appId);
    });
    try {
      await eden.dispose();
      expect(notifications).toContain(appId);
      expect(processes.getAppInstance(appId)).toBeUndefined();
      expect(runtimeContexts.get(appId)).toBeUndefined();
      expect(views.getViewInfo(view.id)).toBeUndefined();
      expect(view.view.webContents.isDestroyed()).toBe(true);
      expect(backends.hasBackend(appId)).toBe(false);
      expect(eden.platform.activeResourceCount).toBe(0);
    } finally {
      off();
    }
  });

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
    const native = await backend();
    eden.runtime.services.permissions.registerApp(appId, ["appbus/expose"]);
    await expect(
      eden.execute(
        "appbus/register",
        { serviceName: "startup-service" },
        { appId, principal: { kind: "user", profile } },
      ),
    ).resolves.toEqual({ success: true });
    native.emit("message", { type: "backend-ready" });
    const failed = await starting;
    expect(failed).toMatchObject({ _tag: "ViewNativeFailure", appId });
    if (!(failed instanceof ViewNativeFailure))
      throw new Error("Expected native view failure");
    expect(failed.cause).toBe(failure);
    expect(eden.platform.utilityProcesses.activeCount).toBe(0);
    expect(eden.platform.activeResourceCount).toBe(baseline);
    expect(
      eden.runtime.services.processes.getAppInstance(appId),
    ).toBeUndefined();
    expect(eden.runtime.services.runtimeContexts.get(appId)).toBeUndefined();
    await expect(eden.execute("appbus/list")).resolves.toEqual({
      services: [],
    });
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

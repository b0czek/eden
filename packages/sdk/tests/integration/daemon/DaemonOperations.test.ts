import type { OperationHandle, RuntimeAppManifest } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { fromPromise } from "../../../src/effects/io";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/createTestEden";

async function readyBackend(eden: TestEden, previousPid = 0) {
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    const effect = eden.platform.effects
      .filter((item) => item.type === "utility-process-started")
      .at(-1);
    if (
      effect?.type === "utility-process-started" &&
      effect.pid !== previousPid
    ) {
      eden.platform.utilityProcesses
        .get(effect.pid)!
        .emit("message", { type: "backend-ready" });
      return effect.pid;
    }
    await tick();
  }
  throw new Error("Daemon backend did not start");
}

describe("daemon operation lifecycle", () => {
  let eden: TestEden;
  afterEach(async () => {
    await eden.dispose();
  });

  it("keeps a daemon supervised when status persistence reads fail", async () => {
    eden = await createTestEden();
    const appId = "com.example.reporting-daemon";
    eden.runtime.services.installedPackages.register(
      testApp(appId, { frontend: undefined, backend: { entry: "backend.js" } }),
    );
    const profile = await eden.runtime.effects.run(
      eden.runtime.users.create({ name: "Daemon", password: "password" }),
    );
    await eden.runtime.effects.run(
      eden.runtime.daemons.updateDefinition({
        appId,
        enabled: false,
        runAs: { kind: "user", username: profile.username },
        restart: "always",
      }),
    );
    const reads = jest
      .spyOn(eden.runtime.services.settings, "list")
      .mockReturnValue(Effect.fail(new Error("settings unavailable")));
    try {
      const starting = eden.runtime.effects.run(
        eden.runtime.daemons.start(appId),
      );
      const pid = await readyBackend(eden);
      await starting;
      const backend = eden.platform.utilityProcesses.get(pid);
      if (!backend) throw new Error("Daemon backend did not start");
      backend.kill();
      expect(await readyBackend(eden, pid)).not.toBe(pid);
    } finally {
      reads.mockRestore();
    }
  });

  it("retains start, restart, and stop completion across real daemon and process managers", async () => {
    eden = await createTestEden();
    const appId = "com.example.operation-daemon";
    eden.runtime.services.installedPackages.register({
      kind: "app",
      id: appId,
      name: "Operation daemon",
      version: "1.0.0",
      backend: { entry: "backend.js" },
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    } as RuntimeAppManifest);
    const profile = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "daemon",
        name: "Daemon",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.daemons.updateDefinition({
        appId,
        enabled: false,
        runAs: { kind: "user", username: profile.username },
        restart: "never",
      }),
    );
    const states: string[] = [];
    eden.runtime.services.daemons.changed.on(({ status }) => {
      if (status.appId === appId) states.push(status.state);
    });
    const daemons = eden.runtime.services.operations;
    const ready = (previousPid = 0) => readyBackend(eden, previousPid);
    const start = await eden.execute<OperationHandle>("daemon/start", {
      appId,
    });
    expect(daemons.get(start).status).toBe("queued");
    const pid = await ready();
    await expect(
      eden.runtime.effects.run(daemons.wait(start)),
    ).resolves.toEqual({ success: true });
    expect(
      (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0].state,
    ).toBe("active");
    const restart = await eden.execute<OperationHandle>("daemon/restart", {
      appId,
    });
    expect(await ready(pid)).not.toBe(pid);
    await expect(
      eden.runtime.effects.run(daemons.wait(restart)),
    ).resolves.toEqual({ success: true });
    const stop = await eden.execute<OperationHandle>("daemon/stop", { appId });
    await expect(eden.runtime.effects.run(daemons.wait(stop))).resolves.toEqual(
      { success: true },
    );
    expect(
      eden.runtime.services.processes.getAppInstance(appId),
    ).toBeUndefined();
    expect(daemons.get(stop)).toMatchObject({
      status: "succeeded",
      phase: "stopping-daemon",
    });
    await eden.dispose();
    expect(states).toContain("active");
    expect(states.at(-1)).toBe("inactive");
  });
  it("keeps replacements supervised across delayed stop notifications and process reloads", async () => {
    eden = await createTestEden();
    const appId = "com.example.queued-daemon";
    eden.runtime.services.installedPackages.register(
      testApp(appId, { frontend: undefined, backend: { entry: "backend.js" } }),
    );
    const profile = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "daemon",
        name: "Daemon",
        password: "password",
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.daemons.updateDefinition({
        appId,
        enabled: false,
        runAs: { kind: "user", username: profile.username },
        restart: "always",
      }),
    );
    const launching = eden.runtime.effects.run(
      eden.runtime.daemons.start(appId),
    );
    const pid = await readyBackend(eden);
    await launching;

    const queued = gate();
    const resume = gate();
    const processed = gate();
    const daemons = eden.runtime.services.daemons;
    const stopped = daemons.processStopped;
    const pause = jest
      .spyOn(daemons, "processStopped")
      .mockImplementation((id) => {
        const notification = stopped(id);
        if (id !== appId) return notification;
        queued.release();
        return fromPromise(() => resume.promise).pipe(
          Effect.andThen(notification),
          Effect.ensuring(Effect.sync(() => processed.release())),
        );
      });
    try {
      const restarting = eden.runtime.effects.run(
        eden.runtime.daemons.restart(appId),
      );
      await queued.promise;
      const nextPid = await readyBackend(eden, pid);
      await restarting;
      resume.release();
      await processed.promise;
      expect(
        (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0],
      ).toMatchObject({
        state: "active",
        restartCount: 0,
        lastError: undefined,
      });
      expect(nextPid).not.toBe(pid);

      const reloading = eden.runtime.effects.run(
        eden.runtime.services.processes.reloadApp(appId),
      );
      const reloadedPid = await readyBackend(eden, nextPid);
      await reloading;

      const backoff = gate();
      const off = daemons.changed.on(({ status }) => {
        if (status.appId === appId && status.state === "backoff")
          backoff.release();
      });
      try {
        eden.platform.utilityProcesses.get(reloadedPid)!.kill();
        await backoff.promise;
        expect(
          (await eden.runtime.effects.run(eden.runtime.daemons.list()))[0],
        ).toMatchObject({
          state: "backoff",
          restartCount: 1,
        });
      } finally {
        off();
      }
    } finally {
      resume.release();
      pause.mockRestore();
    }
  });
});

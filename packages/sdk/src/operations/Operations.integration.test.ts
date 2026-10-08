import "reflect-metadata";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  OperationHandle,
  OperationSnapshot,
  RuntimeAppManifest,
} from "@edenapp/types";
import { createOperationsAPI } from "../app-runtime/common/operations-api";
import { ExecutionContext } from "../execution/ExecutionContext";
import { RuntimeContextRegistry } from "../execution/RuntimeContextRegistry";
import {
  CommandRegistry,
  EdenHandler,
  EdenNamespace,
  IPCBridge,
  PermissionRegistry,
} from "../ipc";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { BackendManager } from "../process-manager/BackendManager";
import { ProcessManager } from "../process-manager/ProcessManager";
import { SessionContext } from "../session/SessionContext";
import { SessionManager } from "../session/SessionManager";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { ViewManager } from "../view-manager/ViewManager";
import { OperationManager } from "./OperationManager";
import { OperationQuota } from "./OperationQuota";
import {
  type OperationReporter,
  type OperationTask,
  operationTask,
} from "./OperationTask";

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function gate() {
  let release!: () => void;
  return {
    promise: new Promise<void>((resolve) => {
      release = resolve;
    }),
    release: () => release(),
  };
}

// Register through production metadata without adding test commands to codegen.
class Work {
  constructor(
    private run: (args: { value: string }) => OperationTask<unknown>,
  ) {}
  prepare(args: { value: string }): OperationTask<unknown> {
    return this.run(args);
  }
}
EdenNamespace("integration")(Work);
EdenHandler("work", { mode: "operation", permission: "work" })(
  Work.prototype,
  "prepare",
  Object.getOwnPropertyDescriptor(Work.prototype, "prepare")!,
);

function app(appId: string): RuntimeAppManifest {
  return {
    kind: "app",
    id: appId,
    name: appId,
    version: "1.0.0",
    frontend: { entry: "index.html" },
    isPrebuilt: false,
    isDevelopment: false,
    isCore: false,
    isRestricted: false,
    resolvedGrants: [],
  } as RuntimeAppManifest;
}

describe("runtime-owned operations", () => {
  let eden: TestEden;
  let manager: OperationManager;
  const owner = { appId: "work.app", principal: { kind: "system" as const } };
  beforeEach(async () => {
    eden = await createTestEden();
    manager = eden.runtime.resolve(OperationManager);
    eden.runtime
      .resolve(PermissionRegistry)
      .registerApp(owner.appId, ["integration/work"]);
  });
  afterEach(async () => {
    await eden.dispose();
  });
  const register = (run: (args: { value: string }) => OperationTask<unknown>) =>
    eden.runtime.resolve(CommandRegistry).registerManager(new Work(run));
  const submit = (value = "value", requestKey?: string) =>
    eden.runtime
      .resolve(CommandRegistry)
      .execute<OperationHandle>("integration/work", { value }, owner, {
        requestKey,
      });

  it("rejects cancellation for tasks that do not support it", async () => {
    register(() => operationTask(async () => "done"));
    const handle = await submit();
    expect(manager.get(handle, owner).cancellable).toBe(false);
    await expect(
      eden.execute("operation/cancel", { handle }, owner),
    ).rejects.toThrow("cannot be cancelled");
    await expect(manager.wait(handle, owner)).resolves.toBe("done");
  });

  it("accepts promptly, queues execution, retains completion and captured context", async () => {
    const blocked = gate();
    const file = path.join(eden.paths.root, "accepted.txt");
    register(({ value }) =>
      operationTask(async (reporter) => {
        expect(eden.runtime.resolve(ExecutionContext).get()?.appId).toBe(
          owner.appId,
        );
        reporter.update("writing");
        await blocked.promise;
        await fs.writeFile(file, value);
        return { value };
      }),
    );
    const handle = await submit();
    const accepted = manager.get(handle, owner);
    expect(accepted.status).toBe("queued");
    await tick();
    const running = manager.get(handle, owner);
    expect(running).toMatchObject({
      status: "running",
      phase: "writing",
    });
    expect(running.revision).toBeGreaterThan(accepted.revision);
    blocked.release();
    await expect(manager.wait(handle, owner)).resolves.toEqual({
      value: "value",
    });
    expect(await fs.readFile(file, "utf8")).toBe("value");
    expect(manager.get(handle, owner)).toMatchObject({
      status: "succeeded",
      result: { value: "value" },
    });
    expect(eden.runtime.operations.get(handle)?.status).toBe("succeeded");
  });

  it("observes completion that predates subscription and reconciles revisions", async () => {
    register(() => operationTask(async () => "done"));
    const handle = await submit();
    await manager.wait(handle, owner);
    const completed = manager.get(handle, owner);
    const callbacks = new Set<
      (data: { snapshot: OperationSnapshot }) => void
    >();
    const off = manager.on("changed", (data) => {
      for (const callback of callbacks) callback(data);
    });
    const api = createOperationsAPI({
      shellCommand: (command, args) => eden.execute(command, args, owner),
      subscribe: async (_event, callback) => {
        callbacks.add(
          callback as (data: { snapshot: OperationSnapshot }) => void,
        );
      },
      unsubscribe: (_event, callback) => {
        callbacks.delete(
          callback as (data: { snapshot: OperationSnapshot }) => void,
        );
      },
    });
    await expect(api.from(handle).result()).resolves.toBe("done");
    expect(callbacks.size).toBe(0);
    const revisions: number[] = [];
    const stop = await api
      .from(handle)
      .watch((snapshot) => revisions.push(snapshot.revision));
    for (const callback of callbacks)
      callback({
        snapshot: { ...completed, revision: completed.revision - 1 },
      });
    expect(revisions).toEqual([completed.revision]);
    stop();
    off();
  });

  it("deduplicates before preparation, rejects mismatches, and enforces scoped reads", async () => {
    const blocked = gate();
    let preparations = 0;
    register(() => {
      preparations++;
      return operationTask(async () => {
        await blocked.promise;
        return "done";
      });
    });
    const first = await submit("a", "request");
    expect(await submit("a", "request")).toEqual(first);
    await expect(submit("b", "request")).rejects.toThrow(
      "different command or arguments",
    );
    expect(preparations).toBe(1);
    expect(() =>
      manager.get(first, { ...owner, appId: "another.app" }),
    ).toThrow("access denied");
    expect(() =>
      manager.get(first, { ...owner, sessionId: "another-session" }),
    ).toThrow("access denied");
    expect(manager.list({ ...owner, appId: "another.app" })).toEqual([]);
    blocked.release();
    await manager.wait(first, owner);
  });

  it("retains typed failure responses and sanitizes thrown failures", async () => {
    register(() =>
      operationTask(async () => ({
        success: false,
        error: "Invalid input",
        validation: { field: "value" },
      })),
    );
    const domain = await submit();
    await expect(manager.wait(domain, owner)).resolves.toMatchObject({
      success: false,
      validation: { field: "value" },
    });
    expect(manager.get(domain, owner)).toMatchObject({
      status: "failed",
      response: { success: false },
    });
    register(() =>
      operationTask(async () => {
        throw new TypeError("Unavailable");
      }),
    );
    const thrown = await submit();
    await expect(manager.wait(thrown, owner)).rejects.toThrow("Unavailable");
    expect(manager.get(thrown, owner)).toMatchObject({
      status: "failed",
      error: { name: "TypeError", message: "Unavailable" },
    });
    expect(JSON.stringify(manager.get(thrown, owner))).not.toContain("stack");
  });

  it("reserves capacity before preparation and retains results and keys until expiry", async () => {
    const blocked = gate();
    const now = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(now);
    let preparations = 0;
    register(({ value }) => {
      preparations++;
      return operationTask(async () => {
        if (value === "active") await blocked.promise;
        return value;
      });
    });
    try {
      const active = await submit("active", "active-key");
      const handles: OperationHandle[] = [];
      for (let i = 1; i < OperationQuota.perAppLimit; i++) {
        const handle = await submit(String(i), `key-${i}`);
        handles.push(handle);
        await manager.wait(handle, owner);
      }
      await expect(submit("rejected")).rejects.toThrow("capacity exhausted");
      expect(preparations).toBe(OperationQuota.perAppLimit);
      expect(await submit("active", "active-key")).toEqual(active);
      expect(await submit("1", "key-1")).toEqual(handles[0]);
      await expect(submit("different", "key-1")).rejects.toThrow(
        "different command or arguments",
      );
      // Session changes cannot multiply an app's allowance.
      await expect(
        eden.runtime
          .resolve(CommandRegistry)
          .execute(
            "integration/work",
            { value: "other-session" },
            { ...owner, sessionId: "other-session" },
          ),
      ).rejects.toThrow("capacity exhausted");
      clock.mockReturnValue(now + OperationManager.retentionMs - 1);
      expect(manager.list(owner)).toHaveLength(OperationQuota.perAppLimit);
      expect(await manager.wait(handles[0], owner)).toBe("1");
      await expect(submit("still-full")).rejects.toThrow("capacity exhausted");
      clock.mockReturnValue(now + OperationManager.retentionMs);
      expect(manager.list(owner)).toHaveLength(1);
      expect(manager.get(active, owner).status).toBe("running");
      expect(() => manager.get(handles[0], owner)).toThrow("not found");
      const next = await submit("new-value", "key-1");
      expect(next.id).not.toBe(handles[0].id);
      await expect(manager.wait(next, owner)).resolves.toBe("new-value");
      blocked.release();
      await manager.wait(active, owner);
      clock.mockReturnValue(now + 2 * OperationManager.retentionMs - 1);
      expect(manager.get(active, owner).status).toBe("succeeded");
      clock.mockReturnValue(now + 2 * OperationManager.retentionMs);
      expect(manager.list(owner)).toEqual([]);
    } finally {
      clock.mockRestore();
      blocked.release();
    }
  });

  it("preserves app and host allowances with a full shared pool and reclaims expired burst capacity", async () => {
    const blocked = gate();
    const now = Date.now();
    const clock = jest.spyOn(Date, "now").mockReturnValue(now);
    register(({ value }) =>
      operationTask(async () => {
        if (value === "active") await blocked.promise;
        return value;
      }),
    );
    const callers = [
      owner,
      ...["busy.app", "burst.app", "quiet.app"].map((appId) => ({
        ...owner,
        appId,
      })),
    ];
    for (const caller of callers)
      eden.runtime
        .resolve(PermissionRegistry)
        .registerApp(caller.appId, ["integration/work"]);
    const submitFor = (
      caller: typeof owner | { principal: typeof owner.principal },
      value = "active",
    ) =>
      eden.runtime
        .resolve(CommandRegistry)
        .execute<OperationHandle>("integration/work", { value }, caller);
    try {
      let remainingShared = OperationQuota.sharedLimit;
      for (const caller of callers.slice(0, 3)) {
        const burst = Math.min(
          remainingShared,
          OperationQuota.perAppLimit - OperationQuota.reservedPerApp,
        );
        remainingShared -= burst;
        for (let i = 0; i < OperationQuota.reservedPerApp + burst; i++) {
          const handle = await submitFor(
            caller,
            caller === owner ? "done" : "active",
          );
          if (caller === owner) await manager.wait(handle, caller);
        }
      }
      expect(remainingShared).toBe(0);
      await expect(submitFor(callers[2])).rejects.toThrow(
        "Shared operation capacity exhausted",
      );
      // A new app and the host still get their entire reserved allowance.
      const host = { principal: owner.principal };
      for (const caller of [callers[3], host]) {
        for (let i = 0; i < OperationQuota.reservedPerApp; i++)
          await submitFor(caller);
        expect(manager.list(caller)).toHaveLength(
          OperationQuota.reservedPerApp,
        );
        expect(
          manager
            .list(caller)
            .every((snapshot) => snapshot.status === "queued"),
        ).toBe(true);
        await expect(submitFor(caller)).rejects.toThrow(
          "Shared operation capacity exhausted",
        );
      }
      await tick();
      clock.mockReturnValue(now + OperationManager.retentionMs);
      // Only the first app's completed records expire; active records stay.
      expect(manager.list(owner)).toEqual([]);
      expect(manager.list(callers[1])).toHaveLength(OperationQuota.perAppLimit);
      for (
        let i = OperationQuota.reservedPerApp;
        i < OperationQuota.perAppLimit;
        i++
      )
        await submitFor(callers[3]);
      expect(manager.list(callers[3])).toHaveLength(OperationQuota.perAppLimit);
      await expect(submitFor(callers[2])).rejects.toThrow(
        "Shared operation capacity exhausted",
      );
      // Reading or expiring another app's records never removes active work.
      expect(manager.list(callers[2])).toHaveLength(
        OperationQuota.reservedPerApp +
          OperationQuota.sharedLimit -
          2 * (OperationQuota.perAppLimit - OperationQuota.reservedPerApp),
      );
    } finally {
      clock.mockRestore();
      blocked.release();
    }
    await manager.drain();
  });

  it("returns reserved and shared capacity when preparation fails", async () => {
    register(() => {
      throw new Error("Preparation failed");
    });
    await expect(submit("retry", "failed-preparation")).rejects.toThrow(
      "Preparation failed",
    );
    expect(manager.list(owner)).toEqual([]);
    register(() => operationTask(async () => "done"));
    for (let i = 1; i < OperationQuota.perAppLimit; i++) {
      const handle = await submit();
      await manager.wait(handle, owner);
    }
    register(() => {
      throw new Error("Preparation failed");
    });
    for (let i = 0; i < 3; i++)
      await expect(submit("retry", "failed-preparation")).rejects.toThrow(
        "Preparation failed",
      );
    register(() => null as unknown as OperationTask<unknown>);
    await expect(submit()).rejects.toThrow("synchronously prepare a task");
    register(() => operationTask(async () => "recovered"));
    const handle = await submit("retry", "failed-preparation");
    await expect(manager.wait(handle, owner)).resolves.toBe("recovered");
    await expect(submit()).rejects.toThrow("capacity exhausted");
    expect(manager.list(owner)).toHaveLength(OperationQuota.perAppLimit);
  });

  it("reserves session transitions before acceptance and drains without waiting on itself", async () => {
    const blocked = gate();
    register(() =>
      operationTask(async () => {
        await blocked.promise;
        return "done";
      }),
    );
    const work = await submit();
    const session = eden.runtime.resolve(SessionContext);
    const originalId = session.getSessionId();
    // Exercise the existing awaited session method inside an operation transaction.
    register(() =>
      operationTask(
        async () => {
          await eden.runtime.resolve(SessionManager).logout();
          return "changed";
        },
        { transition: "session" },
      ),
    );
    const transition = await submit();
    await expect(submit()).rejects.toThrow("draining");
    expect(await submit("value", undefined).catch(() => "closed")).toBe(
      "closed",
    );
    await tick();
    expect(session.getSessionId()).toBe(originalId);
    blocked.release();
    await manager.wait(work, owner);
    await expect(
      manager.wait(transition, { ...owner, sessionId: originalId }),
    ).resolves.toBe("changed");
  });

  it("holds a session reservation until the enclosing operation completes", async () => {
    const transitioned = gate();
    const blocked = gate();
    register(() =>
      operationTask(
        async () => {
          await eden.runtime.resolve(SessionManager).logout();
          transitioned.release();
          await blocked.promise;
          return "done";
        },
        { transition: "session" },
      ),
    );
    const handle = await submit();
    try {
      await transitioned.promise;
      expect(manager.get(handle, owner).status).toBe("running");
      await expect(submit()).rejects.toThrow("draining");
      await expect(
        eden.runtime.resolve(SessionManager).logout(),
      ).rejects.toThrow("already in progress");
    } finally {
      blocked.release();
    }
    await expect(manager.wait(handle, owner)).resolves.toBe("done");
    await expect(
      eden.runtime.resolve(SessionManager).logout(),
    ).resolves.toBeUndefined();
  });

  it("drains accepted work before runtime resource disposal", async () => {
    const blocked = gate();
    register(() =>
      operationTask(async () => {
        await blocked.promise;
        await fs.writeFile(path.join(eden.paths.root, "drained"), "done");
      }),
    );
    await submit();
    let disposed = false;
    const shutdown = eden.runtime.dispose().then(() => {
      disposed = true;
    });
    await tick();
    expect(disposed).toBe(false);
    await expect(submit()).rejects.toThrow("draining");
    blocked.release();
    await shutdown;
    expect(
      await fs.readFile(path.join(eden.paths.root, "drained"), "utf8"),
    ).toBe("done");
  });

  it("accepts backend submissions and delivers changes only to the owning backend", async () => {
    const blocked = gate();
    register(() =>
      operationTask(async () => {
        await blocked.promise;
        return "backend-done";
      }),
    );
    const processes = [];
    for (const id of [owner.appId, "other.backend"]) {
      eden.runtime.resolve(RuntimeContextRegistry).register(id, {
        owner: {
          kind: "session",
          sessionId: eden.runtime.resolve(SessionContext).getSessionId(),
          username: null,
        },
        principal: { kind: "system" },
      });
      const manifest = { ...app(id), backend: { entry: "backend.js" } };
      const starting = eden.runtime
        .resolve(BackendManager)
        .createBackend(id, manifest, eden.paths.root);
      await tick();
      const effect = eden.platform.effects
        .filter((item) => item.type === "utility-process-started")
        .at(-1)!;
      if (effect.type !== "utility-process-started")
        throw new Error("Backend did not start");
      const process = eden.platform.utilityProcesses.get(effect.pid)!;
      process.emit("message", { type: "backend-ready" });
      await starting;
      process.emit("message", {
        type: "shell-command",
        command: "event/subscribe",
        commandId: "subscribe",
        args: { eventName: "operation/changed" },
      });
      await tick();
      processes.push(process);
    }
    processes[0].emit("message", {
      type: "shell-command",
      command: "integration/work",
      commandId: "submit",
      args: { value: "backend" },
      submission: { requestKey: "backend-request" },
    });
    await tick();
    const response = processes[0].messages.find(
      (
        message,
      ): message is {
        commandId: string;
        result: { mode: "operation"; handle: OperationHandle };
      } =>
        !!message &&
        typeof message === "object" &&
        "commandId" in message &&
        message.commandId === "submit",
    );
    expect(response?.result).toMatchObject({
      mode: "operation",
      handle: { command: "integration/work", id: expect.any(String) },
    });
    const handle = response!.result.handle;
    expect(manager.get(handle, owner).status).toBe("running");
    blocked.release();
    await manager.wait(handle, owner);
    expect(processes[0].messages).toContainEqual(
      expect.objectContaining({
        type: "shell-event",
        eventName: "operation/changed",
        payload: {
          snapshot: expect.objectContaining({
            id: handle.id,
            status: "succeeded",
          }),
        },
      }),
    );
    expect(JSON.stringify(processes[1].messages)).not.toContain(handle.id);
    for (const process of processes) process.kill();
    const restarting = eden.runtime
      .resolve(BackendManager)
      .createBackend(
        owner.appId,
        { ...app(owner.appId), backend: { entry: "backend.js" } },
        eden.paths.root,
      );
    await tick();
    const restartedEffect = eden.platform.effects
      .filter((effect) => effect.type === "utility-process-started")
      .at(-1)!;
    if (restartedEffect.type !== "utility-process-started")
      throw new Error("Backend did not restart");
    const restarted = eden.platform.utilityProcesses.get(restartedEffect.pid)!;
    restarted.emit("message", { type: "backend-ready" });
    await restarting;
    const afterRestart = await submit();
    await manager.wait(afterRestart, owner);
    expect(restarted.messages).not.toContainEqual(
      expect.objectContaining({
        type: "shell-event",
        eventName: "operation/changed",
      }),
    );
    restarted.kill();
  });

  it("delivers completion-only backend observations and clears them on exit", async () => {
    const blocked = gate();
    let reporter!: OperationReporter;
    register(() =>
      operationTask(async (progress) => {
        reporter = progress;
        await blocked.promise;
        await fs.writeFile(
          path.join(eden.paths.root, "backend-filtered"),
          "finished",
        );
        return "finished";
      }),
    );
    const handle = await submit();
    const start = async () => {
      eden.runtime.resolve(RuntimeContextRegistry).register(owner.appId, {
        owner: {
          kind: "session",
          sessionId: eden.runtime.resolve(SessionContext).getSessionId(),
          username: null,
        },
        principal: { kind: "system" },
      });
      const starting = eden.runtime
        .resolve(BackendManager)
        .createBackend(
          owner.appId,
          { ...app(owner.appId), backend: { entry: "backend.js" } },
          eden.paths.root,
        );
      await tick();
      const effect = eden.platform.effects
        .filter((item) => item.type === "utility-process-started")
        .at(-1)!;
      if (effect.type !== "utility-process-started")
        throw new Error("Backend did not start");
      const process = eden.platform.utilityProcesses.get(effect.pid)!;
      process.emit("message", { type: "backend-ready" });
      await starting;
      return process;
    };
    let process: Awaited<ReturnType<typeof start>> | undefined;
    try {
      process = await start();
      process.emit("message", {
        type: "shell-command",
        command: "event/subscribe",
        commandId: "terminal",
        args: {
          eventName: "operation/changed",
          operation: { handle, terminalOnly: true },
        },
      });
      await tick();
      reporter.update("writing");
      expect(manager.get(handle, owner).phase).toBe("writing");
      expect(process.messages).not.toContainEqual(
        expect.objectContaining({
          type: "shell-event",
          eventName: "operation/changed",
        }),
      );
      blocked.release();
      await expect(manager.wait(handle, owner)).resolves.toBe("finished");
      expect(
        await fs.readFile(
          path.join(eden.paths.root, "backend-filtered"),
          "utf8",
        ),
      ).toBe("finished");
      expect(
        process.messages.filter(
          (message) =>
            !!message &&
            typeof message === "object" &&
            "type" in message &&
            message.type === "shell-event",
        ),
      ).toEqual([
        expect.objectContaining({
          eventName: "operation/changed",
          payload: {
            snapshot: expect.objectContaining({
              id: handle.id,
              status: "succeeded",
              result: "finished",
            }),
          },
        }),
      ]);
      process.kill();
      process = await start();
      // A restarted backend must not inherit interest in the previous operation.
      eden.runtime.resolve(IPCBridge).eventSubscribers.notify(
        "operation/changed",
        { snapshot: manager.get(handle, owner) },
        {
          appId: owner.appId,
          sessionId: eden.runtime.resolve(SessionContext).getSessionId(),
          operation: { handle, terminal: true },
        },
      );
      expect(process.messages).not.toContainEqual(
        expect.objectContaining({
          type: "shell-event",
          eventName: "operation/changed",
        }),
      );
    } finally {
      blocked.release();
      process?.kill();
    }
  });

  it("keeps work across caller closure and reopening and filters renderer/backend notifications", async () => {
    const permissions = eden.runtime.resolve(PermissionRegistry);
    const registry = eden.runtime.resolve(PackageRegistry);
    const profile = {
      username: "vendor",
      name: "Vendor",
      role: "vendor" as const,
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    eden.runtime.resolve(SessionContext).setCurrentUser(profile);
    const launch = (id: string) =>
      eden.runtime
        .resolve(ExecutionContext)
        .run({ principal: { kind: "user", profile } }, () =>
          eden.runtime.resolve(ProcessManager).launchApp(id),
        );
    for (const id of [owner.appId, "other.app"]) {
      permissions.registerApp(id, ["integration/work"]);
      registry.register(app(id));
      await launch(id);
    }
    const view = (id: string) =>
      eden.runtime
        .resolve(ViewManager)
        .getViewInfo(
          eden.runtime.resolve(ProcessManager).getAppInstance(id)!.viewId,
        )!.view;
    const invoke = async (id: string, command: string, args: unknown) => {
      const response = (await eden.platform.rendererIpc.invoke(
        "shell-command",
        view(id).webContents.id,
        command,
        args,
      )) as
        | { mode: "operation"; handle: OperationHandle }
        | { mode: "result"; result: unknown };
      return response.mode === "operation" ? response : response.result;
    };
    for (const id of [owner.appId, "other.app"]) {
      await invoke(id, "event/subscribe", { eventName: "operation/changed" });
      const context = eden.runtime.resolve(RuntimeContextRegistry).get(id)!;
      await eden.execute(
        "event/subscribe",
        { eventName: "operation/changed" },
        {
          appId: id,
          principal: { kind: "system" },
          sessionId:
            context.owner.kind === "session"
              ? context.owner.sessionId
              : "runtime",
        },
      );
    }
    const blocked = gate();
    register(() =>
      operationTask(async () => {
        await blocked.promise;
        return "persisted";
      }),
    );
    const originalWebContentsId = view(owner.appId).webContents.id;
    const otherWebContentsId = view("other.app").webContents.id;
    const response = (await invoke(owner.appId, "integration/work", {
      value: "item",
    })) as { mode: "operation"; handle: OperationHandle };
    const handle = response.handle;
    await eden.runtime.resolve(ProcessManager).stopApp(owner.appId);
    blocked.release();
    await manager.wait(handle, owner);
    await launch(owner.appId);
    expect(view(owner.appId).webContents.id).not.toBe(originalWebContentsId);
    expect(
      await invoke(owner.appId, "operation/get", { handle }),
    ).toMatchObject({ status: "succeeded", result: "persisted" });
    await expect(
      invoke("other.app", "operation/get", { handle }),
    ).rejects.toThrow("access denied");
    const messages = eden.platform.effects.filter(
      (effect) =>
        effect.type === "message-sent" &&
        effect.webContentsId === otherWebContentsId,
    );
    expect(JSON.stringify(messages)).not.toContain(handle.id);
  });
});

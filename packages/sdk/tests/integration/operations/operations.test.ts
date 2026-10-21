import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { OperationHandle, OperationSnapshot } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as v from "valibot";
import { createOperationsAPI } from "../../../src/app-runtime/common/operations-api";
import { command, defineController } from "../../../src/controllers/controller";
import { operationQuotaLimits } from "../../../src/operations/quota";
import type { Operations } from "../../../src/operations/service";
import {
  type OperationReporter,
  type OperationTask,
  operationTask,
} from "../../../src/operations/task";
import { testApp } from "../../support/apps";
import { gate, tick } from "../../support/async";
import { createTestEden, type TestEden } from "../../support/create-test-eden";
import { promiseOperationTask } from "../../support/operations";

describe("runtime-owned operations", () => {
  let eden: TestEden;
  let backendScope: Scope.Closeable;
  const acquireBackend = <A, E>(work: Effect.Effect<A, E, Scope.Scope>) =>
    eden.runtime.effects.run(Scope.provide(work, backendScope));
  let operations: Operations;
  let prepareWork: (args: { value: string }) => OperationTask<unknown>;
  const owner = { appId: "work.app", principal: { kind: "system" as const } };
  beforeEach(async () => {
    backendScope = Scope.makeUnsafe();
    eden = await createTestEden();
    operations = eden.runtime.services.operations;
    eden.runtime.services.commands.registerController(
      defineController("integration", {
        commands: {
          work: command({
            permission: "work",
            mode: "operation",
            input: v.object({ value: v.string() }),
            handle: (args) => prepareWork(args),
          }),
        },
      }),
    );
    eden.runtime.services.permissions.registerApp(owner.appId, [
      "integration/work",
    ]);
  });
  afterEach(async () => {
    await Effect.runPromise(Scope.close(backendScope, Exit.void));
    await eden.dispose();
  });
  const register = (run: (args: { value: string }) => OperationTask<unknown>) =>
    (prepareWork = run);
  const submit = (value = "value", requestKey?: string) =>
    eden.runtime.effects.run(
      eden.runtime.services.commands.execute<OperationHandle>(
        "integration/work",
        { value },
        owner,
        {
          requestKey,
        },
      ),
    );

  it("rejects cancellation for tasks that do not support it", async () => {
    register(() => promiseOperationTask(async () => "done"));
    const handle = await submit();
    expect(operations.get(handle, owner).cancellable).toBe(false);
    await expect(
      eden.execute("operation/cancel", { handle }, owner),
    ).rejects.toThrow("cannot be cancelled");
    await expect(
      eden.runtime.effects.run(operations.wait(handle, owner)),
    ).resolves.toBe("done");
  });

  it("interrupts native Effect work and publishes cancellation only after its cleanup", async () => {
    const started = gate();
    const finishWork = gate();
    const finishCleanup = gate();
    let cleaningUp = false;
    register(() =>
      operationTask(
        () =>
          Effect.acquireUseRelease(
            Effect.sync(() => started.release()),
            () => Effect.promise(() => finishWork.promise),
            () =>
              Effect.promise(async () => {
                cleaningUp = true;
                await finishCleanup.promise;
              }),
          ),
        { cancellable: true },
      ),
    );
    const handle = await submit();
    try {
      await started.promise;
      operations.cancel(handle, owner);
      await tick();
      expect(cleaningUp).toBe(true);
      expect(operations.get(handle, owner)).toMatchObject({
        status: "running",
        phase: "cancelling",
      });
      finishCleanup.release();
      await expect(
        eden.runtime.effects.run(operations.wait(handle, owner)),
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(operations.get(handle, owner).status).toBe("cancelled");
    } finally {
      finishWork.release();
      finishCleanup.release();
    }
  });

  it("releases synchronous admission when cancelled before execution", async () => {
    let admitted = false;
    let executed = false;
    register(() => {
      admitted = true;
      return operationTask(
        () =>
          Effect.sync(() => {
            executed = true;
          }),
        {
          cancellable: true,
          release: () => {
            admitted = false;
          },
        },
      );
    });
    const handle = await submit();
    expect(operations.get(handle, owner).status).toBe("queued");
    expect(admitted).toBe(true);
    operations.cancel(handle, owner);
    await expect(
      eden.runtime.effects.run(operations.wait(handle, owner)),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(admitted).toBe(false);
    expect(executed).toBe(false);
  });

  it("accepts promptly, queues execution, retains completion and captured context", async () => {
    const blocked = gate();
    const file = path.join(eden.paths.root, "accepted.txt");
    register(({ value }) =>
      promiseOperationTask(async (reporter) => {
        expect(eden.runtime.services.execution.get()?.appId).toBe(owner.appId);
        reporter.update("writing");
        await blocked.promise;
        await fs.writeFile(file, value);
        return { value };
      }),
    );
    const handle = await submit();
    const accepted = operations.get(handle, owner);
    expect(accepted.status).toBe("queued");
    await tick();
    const running = operations.get(handle, owner);
    expect(running).toMatchObject({
      status: "running",
      phase: "writing",
    });
    expect(running.revision).toBeGreaterThan(accepted.revision);
    blocked.release();
    await expect(
      eden.runtime.effects.run(operations.wait(handle, owner)),
    ).resolves.toEqual({
      value: "value",
    });
    expect(await fs.readFile(file, "utf8")).toBe("value");
    expect(operations.get(handle, owner)).toMatchObject({
      status: "succeeded",
      result: { value: "value" },
    });
    expect(eden.runtime.operations.get(handle)?.status).toBe("succeeded");
  });

  it("observes completion that predates subscription and reconciles revisions", async () => {
    register(() => promiseOperationTask(async () => "done"));
    const handle = await submit();
    await eden.runtime.effects.run(operations.wait(handle, owner));
    const completed = operations.get(handle, owner);
    const callbacks = new Set<
      (data: { snapshot: OperationSnapshot }) => void
    >();
    const off = operations.changed.on(({ payload: data }) => {
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
      return promiseOperationTask(async () => {
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
      operations.get(first, { ...owner, appId: "another.app" }),
    ).toThrow("access denied");
    expect(() =>
      operations.get(first, { ...owner, sessionId: "another-session" }),
    ).toThrow("access denied");
    expect(operations.list({ ...owner, appId: "another.app" })).toEqual([]);
    blocked.release();
    await eden.runtime.effects.run(operations.wait(first, owner));
  });

  it.each([false, { success: false, error: "Payload, not a failure" }])(
    "retains successful payloads without inferring failure: %p",
    async (result) => {
      register(() => operationTask(() => Effect.succeed(result)));
      const handle = await submit();
      await expect(
        eden.runtime.effects.run(operations.wait(handle, owner)),
      ).resolves.toEqual(result);
      expect(operations.get(handle, owner)).toMatchObject({
        status: "succeeded",
        result,
      });
    },
  );

  it.each(["unavailable", { code: "unavailable", retryAfter: 15 }, undefined])(
    "encodes the original typed failure in the public snapshot: %p",
    async (failure) => {
      register(() =>
        operationTask(() => Effect.fail(failure), {
          encodeFailure: (error) => ({ retry: error }),
        }),
      );
      const handle = await submit();
      const exit = await eden.runtime.effects.run(
        Effect.exit(operations.wait(handle, owner)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(operations.get(handle, owner)).toMatchObject({
        status: "failed",
        response: { retry: failure },
      });
    },
  );

  it.each([
    [Cause.die(new Error("defect")), "failed"],
    [
      Cause.combine(
        Cause.fail("unavailable"),
        Cause.die(new Error("cleanup defect")),
      ),
      "failed",
    ],
    [Cause.combine(Cause.fail("unavailable"), Cause.interrupt()), "failed"],
    [Cause.interrupt(), "cancelled"],
  ] as const)(
    "does not encode defects or interrupted causes: %p",
    async (cause, status) => {
      register(() =>
        operationTask(() => Effect.failCause(cause), {
          cancellable: true,
          encodeFailure: () => ({ retry: true }),
        }),
      );
      const handle = await submit();
      const exit = await eden.runtime.effects.run(
        Effect.exit(operations.wait(handle, owner)),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      const snapshot = operations.get(handle, owner);
      expect(snapshot.status).toBe(status);
      expect(snapshot).not.toHaveProperty("response");
    },
  );

  it("sanitizes thrown failures", async () => {
    register(() =>
      promiseOperationTask(async () => {
        throw new TypeError("Unavailable");
      }),
    );
    const thrown = await submit();
    await expect(
      eden.runtime.effects.run(operations.wait(thrown, owner)),
    ).rejects.toThrow("Unavailable");
    expect(operations.get(thrown, owner)).toMatchObject({
      status: "failed",
      error: { name: "TypeError", message: "Unavailable" },
    });
    expect(JSON.stringify(operations.get(thrown, owner))).not.toContain(
      "stack",
    );
  });

  it("returns reserved and shared capacity when preparation fails", async () => {
    register(() => {
      throw new Error("Preparation failed");
    });
    await expect(submit("retry", "failed-preparation")).rejects.toThrow(
      "Preparation failed",
    );
    expect(operations.list(owner)).toEqual([]);
    register(() => promiseOperationTask(async () => "done"));
    for (let i = 1; i < operationQuotaLimits.perAppLimit; i++) {
      const handle = await submit();
      await eden.runtime.effects.run(operations.wait(handle, owner));
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
    register(() => promiseOperationTask(async () => "recovered"));
    const handle = await submit("retry", "failed-preparation");
    await expect(
      eden.runtime.effects.run(operations.wait(handle, owner)),
    ).resolves.toBe("recovered");
    await expect(submit()).rejects.toThrow("capacity exhausted");
    expect(operations.list(owner)).toHaveLength(
      operationQuotaLimits.perAppLimit,
    );
  });

  it("reserves session transitions before acceptance and drains without waiting on itself", async () => {
    const blocked = gate();
    register(() =>
      promiseOperationTask(async () => {
        await blocked.promise;
        return "done";
      }),
    );
    const work = await submit();
    const session = eden.runtime.services.sessionContext;
    const originalId = session.getSessionId();
    // Exercise the existing awaited session method inside an operation transaction.
    register(() =>
      operationTask(
        () => Effect.as(eden.runtime.services.sessions.logout(), "changed"),
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
    await eden.runtime.effects.run(operations.wait(work, owner));
    await expect(
      eden.runtime.effects.run(
        operations.wait(transition, { ...owner, sessionId: originalId }),
      ),
    ).resolves.toBe("changed");
  });

  it("holds a session reservation until the enclosing operation completes", async () => {
    const transitioned = gate();
    const blocked = gate();
    register(() =>
      operationTask(
        () =>
          Effect.gen(function* () {
            yield* eden.runtime.services.sessions.logout();
            transitioned.release();
            yield* Effect.promise(() => blocked.promise);
            return "done";
          }),
        { transition: "session" },
      ),
    );
    const handle = await submit();
    try {
      await transitioned.promise;
      expect(operations.get(handle, owner).status).toBe("running");
      await expect(submit()).rejects.toThrow("draining");
      await expect(
        eden.runtime.effects.run(eden.runtime.services.sessions.logout()),
      ).rejects.toThrow("already in progress");
    } finally {
      blocked.release();
    }
    await expect(
      eden.runtime.effects.run(operations.wait(handle, owner)),
    ).resolves.toBe("done");
    await expect(
      eden.runtime.effects.run(eden.runtime.services.sessions.logout()),
    ).resolves.toBeUndefined();
  });

  it("drains accepted work before runtime resource disposal", async () => {
    const blocked = gate();
    register(() =>
      promiseOperationTask(async () => {
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
      promiseOperationTask(async () => {
        await blocked.promise;
        return "backend-done";
      }),
    );
    const processes = [];
    for (const id of [owner.appId, "other.backend"]) {
      eden.runtime.services.runtimeContexts.register(id, {
        owner: {
          kind: "session",
          sessionId: eden.runtime.services.sessionContext.getSessionId(),
          username: null,
        },
        principal: { kind: "system" },
      });
      const manifest = { ...testApp(id), backend: { entry: "backend.js" } };
      const starting = acquireBackend(
        eden.runtime.services.backends.createBackend(
          id,
          manifest,
          eden.paths.root,
        ),
      );
      await tick();
      const process = eden.getBackendProcess(id);
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
    assert(response, "Backend operation response is missing");
    const handle = response.result.handle;
    expect(operations.get(handle, owner).status).toBe("running");
    blocked.release();
    await eden.runtime.effects.run(operations.wait(handle, owner));
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
    const restarting = acquireBackend(
      eden.runtime.services.backends.createBackend(
        owner.appId,
        { ...testApp(owner.appId), backend: { entry: "backend.js" } },
        eden.paths.root,
      ),
    );
    await tick();
    const restarted = eden.getBackendProcess(owner.appId);
    restarted.emit("message", { type: "backend-ready" });
    await restarting;
    const afterRestart = await submit();
    await eden.runtime.effects.run(operations.wait(afterRestart, owner));
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
      promiseOperationTask(async (progress) => {
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
      eden.runtime.services.runtimeContexts.register(owner.appId, {
        owner: {
          kind: "session",
          sessionId: eden.runtime.services.sessionContext.getSessionId(),
          username: null,
        },
        principal: { kind: "system" },
      });
      const starting = acquireBackend(
        eden.runtime.services.backends.createBackend(
          owner.appId,
          { ...testApp(owner.appId), backend: { entry: "backend.js" } },
          eden.paths.root,
        ),
      );
      await tick();
      const process = eden.getBackendProcess(owner.appId);
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
      expect(operations.get(handle, owner).phase).toBe("writing");
      expect(process.messages).not.toContainEqual(
        expect.objectContaining({
          type: "shell-event",
          eventName: "operation/changed",
        }),
      );
      blocked.release();
      await expect(
        eden.runtime.effects.run(operations.wait(handle, owner)),
      ).resolves.toBe("finished");
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
      eden.runtime.services.ipc.eventSubscribers.notify(
        "operation/changed",
        { snapshot: operations.get(handle, owner) },
        {
          appId: owner.appId,
          sessionId: eden.runtime.services.sessionContext.getSessionId(),
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
    const permissions = eden.runtime.services.permissions;
    const registry = eden.runtime.services.installedPackages;
    const profile = {
      username: "vendor",
      name: "Vendor",
      role: "vendor" as const,
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    eden.runtime.services.sessionContext.setCurrentUser(profile);
    const launch = (id: string) =>
      eden.runtime.effects.run(
        eden.runtime.services.execution.provide(
          eden.runtime.services.processes.launchApp(id),
          { principal: { kind: "user", profile } },
        ),
      );
    for (const id of [owner.appId, "other.app"]) {
      permissions.registerApp(id, ["integration/work"]);
      registry.register(testApp(id));
      await launch(id);
    }
    const invoke = async (id: string, command: string, args: unknown) => {
      const response = (await eden.platform.rendererIpc.invoke(
        "shell-command",
        eden.getAppView(id).view.webContents.id,
        command,
        args,
      )) as
        | { mode: "operation"; handle: OperationHandle }
        | { mode: "result"; result: unknown };
      return response.mode === "operation" ? response : response.result;
    };
    for (const id of [owner.appId, "other.app"]) {
      await invoke(id, "event/subscribe", { eventName: "operation/changed" });
      const context = eden.runtime.services.runtimeContexts.get(id);
      assert(context, "Launched app context is missing");
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
      promiseOperationTask(async () => {
        await blocked.promise;
        return "persisted";
      }),
    );
    const originalWebContentsId = eden.getAppView(owner.appId).view.webContents
      .id;
    const otherWebContentsId = eden.getAppView("other.app").view.webContents.id;
    const response = (await invoke(owner.appId, "integration/work", {
      value: "item",
    })) as { mode: "operation"; handle: OperationHandle };
    const handle = response.handle;
    await eden.runtime.effects.run(
      eden.runtime.services.processes.stopApp(owner.appId),
    );
    blocked.release();
    await eden.runtime.effects.run(operations.wait(handle, owner));
    await launch(owner.appId);
    expect(eden.getAppView(owner.appId).view.webContents.id).not.toBe(
      originalWebContentsId,
    );
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

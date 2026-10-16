import { createHash, randomUUID } from "node:crypto";
import type {
  OperationHandle,
  OperationSnapshot,
  OperationSubmission,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import type { RoutedNotification } from "../controllers/events";
import { fromPromise } from "../effects/io";
import { type EffectRuntime } from "../effects/runtime";
import { createEvent } from "../events/event";
import {
  type CommandCallerContext,
  ExecutionContext,
} from "../execution/context";
import type { Filesystem } from "../filesystem/service";
import { SessionContext } from "../session/context";
import { createOperationQuota } from "./quota";
import type { OperationTask } from "./task";

interface OperationNamespaceEvents {
  changed: { snapshot: OperationSnapshot };
}

interface RecordEntry {
  snapshot: OperationSnapshot;
  cancellation?: AbortController;
  owner: { appId?: string; sessionId: string };
  context: CommandCallerContext;
  done: Promise<void>;
  finish: () => void;
  requestKey?: string;
  fingerprint: string;
  transitionSessionId?: string;
}

/** Stable argument identity without caller-supplied metadata. */
function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

export const operationRetentionMs = 15 * 60 * 1000;
export function createOperations({
  effects,
  execution,
  session,
  filesystem,
}: {
  effects: EffectRuntime;
  execution: ExecutionContext;
  session: SessionContext;
  filesystem: {
    releaseHandles(sessionId?: string): Effect.Effect<void, Error>;
  };
}) {
  const changed =
    createEvent<RoutedNotification<OperationNamespaceEvents["changed"]>>();
  let records = new Map<string, RecordEntry>();
  let requests = new Map<string, string>();
  let quota = createOperationQuota();
  let closedSessions = new Map<string, string>();
  let accepting = true;
  let shuttingDown = false;
  let runtimeTransition: string | undefined;
  let expiryTimer: NodeJS.Timeout;

  expiryTimer = setInterval(() => prune(), 60_000);
  expiryTimer.unref();
  function submit(
    command: string,
    args: unknown,
    context: CommandCallerContext,
    prepare: () => OperationTask<unknown>,
    submission: OperationSubmission = {},
  ): OperationHandle {
    prune();
    const sessionId = context.sessionId ?? session.getSessionId();
    const owner = { appId: context.appId, sessionId };
    const requestKey = submission.requestKey;
    if (
      requestKey !== undefined &&
      (typeof requestKey !== "string" ||
        !requestKey.length ||
        requestKey.length > 256)
    )
      throw new Error("Invalid operation request key");
    const requestIdentity = canonical([sessionId, owner.appId, requestKey]);
    const fingerprint = createHash("sha256")
      .update(canonical([command, args]))
      .digest("hex");
    if (requestKey !== undefined) {
      const previousId = requests.get(requestIdentity);
      const previous = previousId && records.get(previousId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error(
            "Operation request key reused with different command or arguments",
          );
        return { command, id: previous.snapshot.id };
      }
    }
    if (!accepting || closedSessions.has(sessionId))
      throw new Error("Operations are draining; new submissions are closed");
    quota.reserve(owner.appId);
    let retained = false;
    try {
      const task = prepare();
      if (!task || typeof task.run !== "function" || "then" in task)
        throw new Error("Operation handlers must synchronously prepare a task");
      const id = randomUUID();
      const capturedContext = structuredClone({
        ...context,
        sessionId,
        operationId: id,
      });
      const transitionSessionId =
        task.transition === "session" ? session.getSessionId() : undefined;
      if (transitionSessionId) {
        if (closedSessions.has(transitionSessionId))
          throw new Error("A session transition is already in progress");
        closedSessions.set(transitionSessionId, id);
      }
      if (task.transition === "runtime") {
        accepting = false;
        runtimeTransition = id;
      }
      let finish!: () => void;
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const now = Date.now();
      const record: RecordEntry = {
        snapshot: {
          command,
          id,
          cancellable: task.cancellable === true,
          revision: 1,
          status: "queued",
          createdAt: now,
          updatedAt: now,
        },
        owner,
        cancellation: task.cancellable ? new AbortController() : undefined,
        transitionSessionId,
        context: capturedContext,
        done,
        finish,
        fingerprint,
        requestKey: requestKey === undefined ? undefined : requestIdentity,
      };
      records.set(id, record);
      retained = true;
      if (record.requestKey) requests.set(record.requestKey, id);
      publish(record);
      // IPC response delivery is queued before tasks may tear down their caller.
      setImmediate(() => {
        void execution.run(record.context, () => execute(record, task));
      });
      return { command, id };
    } finally {
      if (!retained) quota.release(owner.appId);
    }
  }
  async function runHost<R>(
    command: string,
    args: unknown,
    prepare: () => OperationTask<R>,
  ): Promise<R> {
    const context: CommandCallerContext = {
      principal: { kind: "system" },
      sessionId: session.getSessionId(),
    };
    const handle = submit(command, args, context, prepare);
    return (await wait(handle, context)) as R;
  }
  async function execute(
    record: RecordEntry,
    task: OperationTask<unknown>,
  ): Promise<void> {
    try {
      update(record, { status: "running", startedAt: Date.now() });
      if (task.transition) update(record, { phase: "waiting-for-operations" });
      if (record.transitionSessionId) {
        await effects.run(
          filesystem.releaseHandles(record.transitionSessionId),
        );
        await drainSession(record.transitionSessionId, record.snapshot.id);
      }
      if (task.transition === "runtime") {
        await effects.run(filesystem.releaseHandles());
        await drain(record.snapshot.id);
      }
      const work = task.run({
        signal: record.cancellation?.signal,
        update: (phase, progress) => {
          const previous = record.snapshot.progress;
          const unchanged =
            record.snapshot.phase === phase &&
            previous?.completed === progress?.completed &&
            previous?.total === progress?.total &&
            previous?.unit === progress?.unit;
          if (record.snapshot.status === "running" && !unchanged)
            update(record, { phase, progress: structuredClone(progress) });
        },
      });
      const result = Effect.isEffect(work)
        ? await effects.run(work)
        : await work;
      const failed =
        result === false ||
        (result !== null &&
          typeof result === "object" &&
          "success" in result &&
          result.success === false);
      if (failed) {
        const message =
          result &&
          typeof result === "object" &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "Operation failed";
        update(record, {
          status: "failed",
          completedAt: Date.now(),
          error: { name: "OperationError", message },
          response: structuredClone(result),
        });
      } else
        update(record, {
          status: "succeeded",
          completedAt: Date.now(),
          result: structuredClone(result),
        });
    } catch (error) {
      const failure = Error.isError(error) ? error : undefined;
      if (
        record.cancellation?.signal.aborted &&
        failure?.name === "AbortError"
      ) {
        update(record, { status: "cancelled", completedAt: Date.now() });
      } else {
        update(record, {
          status: "failed",
          completedAt: Date.now(),
          error: {
            name: failure?.name ?? "Error",
            message: failure?.message ?? "Operation failed",
          },
        });
      }
    } finally {
      if (
        task.transition === "session" &&
        closedSessions.get(record.transitionSessionId!) === record.snapshot.id
      )
        closedSessions.delete(record.transitionSessionId!);
      if (
        task.transition === "runtime" &&
        runtimeTransition === record.snapshot.id
      ) {
        runtimeTransition = undefined;
        accepting =
          (record.snapshot.status === "failed" ||
            record.snapshot.status === "cancelled") &&
          !shuttingDown;
      }
      record.finish();
      prune();
    }
  }
  function update(record: RecordEntry, patch: Record<string, unknown>): void {
    record.snapshot = {
      ...record.snapshot,
      ...patch,
      revision: record.snapshot.revision + 1,
      updatedAt: Date.now(),
    } as OperationSnapshot;
    publish(record);
  }
  function publish(record: RecordEntry): void {
    changed.emit({
      payload: { snapshot: structuredClone(record.snapshot) },
      scope: {
        ...record.owner,
        operation: {
          handle: record.snapshot,
          terminal: ["succeeded", "failed", "cancelled"].includes(
            record.snapshot.status,
          ),
        },
      },
    });
  }
  function authorized(
    record: RecordEntry,
    context: CommandCallerContext,
  ): boolean {
    return (
      record.owner.appId === context.appId &&
      record.owner.sessionId === (context.sessionId ?? session.getSessionId())
    );
  }
  function get(
    handle: OperationHandle,
    context = execution.get() ?? {},
  ): OperationSnapshot {
    prune();
    const record = records.get(handle.id);
    if (
      !record ||
      record.snapshot.command !== handle.command ||
      !authorized(record, context)
    )
      throw new Error("Operation not found or access denied");
    return structuredClone(record.snapshot);
  }
  function cancel(
    handle: OperationHandle,
    context = execution.get() ?? {},
  ): void {
    const snapshot = get(handle, context);
    if (snapshot.status !== "queued" && snapshot.status !== "running") return;
    const record = records.get(handle.id)!;
    if (!record.cancellation) throw new Error("Operation cannot be cancelled");
    if (record.cancellation.signal.aborted) return;
    const error = new Error("Operation cancelled");
    error.name = "AbortError";
    record.cancellation.abort(error);
    update(record, { phase: "cancelling" });
  }
  function list(context = execution.get() ?? {}): OperationSnapshot[] {
    prune();
    return [...records.values()]
      .filter((record) => authorized(record, context))
      .map((record) => structuredClone(record.snapshot));
  }
  async function wait(
    handle: OperationHandle,
    context = execution.get() ?? {},
  ): Promise<unknown> {
    get(handle, context);
    const record = records.get(handle.id)!;
    await record.done;
    const snapshot = record.snapshot;
    if (snapshot.status === "succeeded")
      return structuredClone(snapshot.result);
    if (snapshot.status === "cancelled") {
      const error = new Error("Operation cancelled");
      error.name = "AbortError";
      throw error;
    }
    if (snapshot.status === "failed") {
      if ("response" in snapshot) return structuredClone(snapshot.response);
      const error = new Error(snapshot.error.message);
      error.name = snapshot.error.name;
      throw error;
    }
    throw new Error("Operation has not completed");
  }
  function inspect(handle: OperationHandle): OperationSnapshot | undefined {
    prune();
    const record = records.get(handle.id);
    return record?.snapshot.command === handle.command
      ? structuredClone(record.snapshot)
      : undefined;
  }
  function inspectAll(): OperationSnapshot[] {
    prune();
    return [...records.values()].map((record) =>
      structuredClone(record.snapshot),
    );
  }
  async function drainSession(
    sessionId: string,
    excludeId?: string,
  ): Promise<void> {
    await Promise.all(
      [...records.values()]
        .filter(
          (record) =>
            record.owner.sessionId === sessionId &&
            record.snapshot.id !== excludeId,
        )
        .map((record) => record.done),
    );
  }
  function withSessionTransition<A, E>(
    work: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> {
    return Effect.suspend(() => {
      const sessionId = session.getSessionId();
      const operationId = execution.get()?.operationId;
      const reserved = closedSessions.get(sessionId);
      if (reserved)
        return reserved === operationId
          ? work
          : Effect.fail(
              new Error("A session transition is already in progress"),
            );
      if (!accepting)
        return Effect.fail(new Error("Runtime operations are draining"));
      const reservation = operationId ?? randomUUID();
      closedSessions.set(sessionId, reservation);
      return Effect.gen(function* () {
        yield* filesystem.releaseHandles(sessionId);
        yield* fromPromise(() => drainSession(sessionId, operationId));
        return yield* work;
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            if (closedSessions.get(sessionId) === reservation)
              closedSessions.delete(sessionId);
          }),
        ),
      );
    });
  }
  function withRuntimeTransition<A, E>(
    work: Effect.Effect<A, E>,
  ): Effect.Effect<A, E | Error> {
    return Effect.suspend(() => {
      const operationId = execution.get()?.operationId;
      if (runtimeTransition)
        return runtimeTransition === operationId
          ? work
          : Effect.fail(
              new Error("A runtime transition is already in progress"),
            );
      if (!accepting)
        return Effect.fail(new Error("Runtime operations are draining"));
      const reservation = operationId ?? randomUUID();
      runtimeTransition = reservation;
      accepting = false;
      return Effect.gen(function* () {
        yield* filesystem.releaseHandles();
        yield* fromPromise(() => drain(operationId));
        return yield* work;
      }).pipe(
        Effect.onError(() =>
          Effect.sync(() => {
            accepting = !shuttingDown;
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (runtimeTransition === reservation)
              runtimeTransition = undefined;
          }),
        ),
      );
    });
  }
  async function drain(excludeId?: string): Promise<void> {
    await Promise.all(
      [...records.values()]
        .filter((record) => record.snapshot.id !== excludeId)
        .map((record) => record.done),
    );
  }
  async function shutdown(): Promise<void> {
    shuttingDown = true;
    accepting = false;
    await drain(execution.get()?.operationId);
  }
  function prune(): void {
    const now = Date.now();
    for (const record of records.values()) {
      const snapshot = record.snapshot;
      if (
        (snapshot.status === "succeeded" ||
          snapshot.status === "failed" ||
          snapshot.status === "cancelled") &&
        now - snapshot.completedAt >= operationRetentionMs
      ) {
        records.delete(record.snapshot.id);
        if (record.requestKey) requests.delete(record.requestKey);
        quota.release(record.owner.appId);
      }
    }
  }
  function dispose(): void {
    clearInterval(expiryTimer);
    records.clear();
    requests.clear();
    quota.clear();
    changed.dispose();
  }
  return {
    changed,
    submit,
    runHost,
    get,
    cancel,
    list,
    wait,
    inspect,
    inspectAll,
    drainSession,
    withSessionTransition,
    withRuntimeTransition,
    drain,
    shutdown,
    dispose,
  };
}
export type Operations = ReturnType<typeof createOperations>;

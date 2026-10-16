import { createHash, randomUUID } from "node:crypto";
import type {
  OperationHandle,
  OperationSnapshot,
  OperationSubmission,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import type { RoutedNotification } from "../controllers/events";
import { asError } from "../effects/io";
import { type EffectRuntime } from "../effects/runtime";
import { createEvent } from "../events/event";
import {
  type CommandCallerContext,
  ExecutionContext,
} from "../execution/context";
import { SessionContext } from "../session/context";
import { createOperationQuota } from "./quota";
import type { OperationTask } from "./task";

interface OperationNamespaceEvents {
  changed: { snapshot: OperationSnapshot };
}

interface RecordEntry {
  snapshot: OperationSnapshot;
  owner: { appId?: string; sessionId: string };
  fiber: Fiber.Fiber<unknown, unknown>;
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
  const expiry = effects.fork(
    Effect.forever(Effect.andThen(Effect.sleep(60_000), Effect.sync(prune))),
  );
  // The transport must queue its acceptance response before execution can tear
  // down the submitting view or backend.
  const afterResponse = Effect.callback<void>((resume) => {
    const immediate = setImmediate(() => resume(Effect.void));
    return Effect.sync(() => clearImmediate(immediate));
  });
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
    let task: OperationTask<unknown> | undefined;
    let id: string | undefined;
    let transitionSessionId: string | undefined;
    try {
      task = prepare();
      if (!task || typeof task.run !== "function" || "then" in task)
        throw new Error("Operation handlers must synchronously prepare a task");
      const prepared = task;
      id = randomUUID();
      const capturedContext = structuredClone({
        ...context,
        sessionId,
        operationId: id,
      });
      transitionSessionId =
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
        transitionSessionId,
        fiber: execution.run(capturedContext, () =>
          effects.fork(
            execution.provide(
              Effect.andThen(
                afterResponse,
                Effect.suspend(() => execute(record, prepared)),
              ),
              capturedContext,
            ),
          ),
        ),
        fingerprint,
        requestKey: requestKey === undefined ? undefined : requestIdentity,
      };
      records.set(id, record);
      retained = true;
      if (record.requestKey) requests.set(record.requestKey, id);
      record.fiber.addObserver((exit) => complete(record, prepared, exit));
      publish(record);
      return { command, id };
    } finally {
      if (!retained) {
        if (
          transitionSessionId &&
          closedSessions.get(transitionSessionId) === id
        )
          closedSessions.delete(transitionSessionId);
        if (id && runtimeTransition === id) {
          runtimeTransition = undefined;
          accepting = !shuttingDown;
        }
        try {
          task?.release?.();
        } finally {
          quota.release(owner.appId);
        }
      }
    }
  }
  function runHost<R>(
    command: string,
    args: unknown,
    prepare: () => OperationTask<R>,
  ): Effect.Effect<R, unknown> {
    return Effect.gen(function* () {
      const context: CommandCallerContext = {
        principal: { kind: "system" },
        sessionId: session.getSessionId(),
      };
      const handle = yield* Effect.try({
        try: () => submit(command, args, context, prepare),
        catch: asError,
      });
      return (yield* wait(handle, context)) as R;
    });
  }
  const execute = Effect.fn(function* (
    record: RecordEntry,
    task: OperationTask<unknown>,
  ) {
    update(record, { status: "running", startedAt: Date.now() });
    if (task.transition) update(record, { phase: "waiting-for-operations" });
    if (record.transitionSessionId) {
      yield* filesystem.releaseHandles(record.transitionSessionId);
      yield* drainSession(record.transitionSessionId, record.snapshot.id);
    }
    if (task.transition === "runtime") {
      yield* filesystem.releaseHandles();
      yield* drain(record.snapshot.id);
    }
    return structuredClone(
      yield* task.run({
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
      }),
    );
  });
  function complete(
    record: RecordEntry,
    task: OperationTask<unknown>,
    exit: Exit.Exit<unknown, unknown>,
  ) {
    try {
      task.release?.();
      if (Exit.isSuccess(exit)) {
        update(record, {
          status: "succeeded",
          completedAt: Date.now(),
          result: exit.value,
        });
      } else if (Cause.hasInterruptsOnly(exit.cause)) {
        update(record, { status: "cancelled", completedAt: Date.now() });
      } else {
        const failure = asError(Cause.squash(exit.cause));
        update(record, {
          status: "failed",
          completedAt: Date.now(),
          error: { name: failure.name, message: failure.message },
          ...(task.encodeFailure
            ? { response: structuredClone(task.encodeFailure(failure)) }
            : {}),
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
    if (!snapshot.cancellable) throw new Error("Operation cannot be cancelled");
    if (snapshot.phase === "cancelling") return;
    update(record, { phase: "cancelling" });
    record.fiber.interruptUnsafe();
  }
  function list(context = execution.get() ?? {}): OperationSnapshot[] {
    prune();
    return [...records.values()]
      .filter((record) => authorized(record, context))
      .map((record) => structuredClone(record.snapshot));
  }
  function wait(
    handle: OperationHandle,
    context = execution.get() ?? {},
  ): Effect.Effect<unknown, unknown> {
    return Effect.suspend(() => {
      get(handle, context);
      const record = records.get(handle.id)!;
      return Fiber.join(record.fiber).pipe(
        Effect.map((value) => structuredClone(value)),
        Effect.catchCause((cause) => {
          if (!Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause);
          const error = new Error("Operation cancelled");
          error.name = "AbortError";
          return Effect.fail(error);
        }),
      );
    });
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
  function drainSession(sessionId: string, excludeId?: string) {
    return Effect.suspend(() =>
      Effect.asVoid(
        Fiber.awaitAll(
          [...records.values()]
            .filter(
              (record) =>
                record.owner.sessionId === sessionId &&
                record.snapshot.id !== excludeId,
            )
            .map((record) => record.fiber),
        ),
      ),
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
        yield* drainSession(sessionId, operationId);
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
        yield* drain(operationId);
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
  function drain(excludeId?: string) {
    return Effect.suspend(() =>
      Effect.asVoid(
        Fiber.awaitAll(
          [...records.values()]
            .filter((record) => record.snapshot.id !== excludeId)
            .map((record) => record.fiber),
        ),
      ),
    );
  }
  const shutdown = Effect.fn(function* () {
    shuttingDown = true;
    accepting = false;
    yield* drain(execution.get()?.operationId);
  });
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
  const dispose = Effect.fn(function* () {
    yield* shutdown();
    yield* Fiber.interrupt(expiry);
    records.clear();
    requests.clear();
    quota.clear();
    changed.dispose();
  });

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

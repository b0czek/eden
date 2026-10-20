import { createHash, randomUUID } from "node:crypto";
import type {
  OperationHandle,
  OperationSnapshot,
  OperationSubmission,
} from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import type { RoutedNotification } from "../controllers/events";
import { asError } from "../effects/io";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import {
  type CommandCallerContext,
  ExecutionContext,
} from "../execution/context";
import { Filesystem } from "../filesystem/service";
import { SessionContext } from "../session/context";
import {
  type HostOperationFailure,
  InvalidOperationRequestKey,
  OperationAdmissionClosed,
  type OperationAdmissionFailure,
  OperationCancelled,
  OperationCapacityExhausted,
  OperationNotCancellable,
  OperationNotFound,
  OperationRequestConflict,
  SessionTransitionInProgress,
} from "./errors";
import { createOperationQuota } from "./quota";
import type { OperationTask } from "./task";

export interface Operations {
  changed: Event<RoutedNotification<{ snapshot: OperationSnapshot }>>;
  /** Synchronous admission; throws OperationAdmissionFailure or a preparation rejection. */
  submit: (
    command: string,
    args: unknown,
    context: CommandCallerContext,
    prepare: () => OperationTask<unknown>,
    submission?: OperationSubmission,
  ) => OperationHandle;
  runHost: <R, E, P>(
    command: string,
    args: unknown,
    prepare: Effect.Effect<OperationTask<R, E>, P>,
  ) => Effect.Effect<R, E | P | HostOperationFailure>;
  /** Throws OperationNotFound when the handle is absent or inaccessible. */
  get: (
    handle: OperationHandle,
    context?: CommandCallerContext,
  ) => OperationSnapshot;
  /** Throws OperationNotFound or OperationNotCancellable synchronously. */
  cancel: (handle: OperationHandle, context?: CommandCallerContext) => void;
  list: (context?: CommandCallerContext) => OperationSnapshot[];
  wait: (
    handle: OperationHandle,
    context?: CommandCallerContext,
  ) => Effect.Effect<unknown, unknown>;
  inspect: (handle: OperationHandle) => OperationSnapshot | undefined;
  inspectAll: () => OperationSnapshot[];
  drainSession: (sessionId: string, excludeId?: string) => Effect.Effect<void>;
  withSessionTransition: <A, E>(
    work: Effect.Effect<A, E>,
  ) => Effect.Effect<
    A,
    E | OperationAdmissionClosed | SessionTransitionInProgress
  >;
  drain: (excludeId?: string) => Effect.Effect<void>;
  closeAdmission: () => void;
  shutdown: () => Effect.Effect<void>;
}

export const Operations = Context.Service<"eden/Operations", Operations>(
  "eden/Operations",
);

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
export const OperationsLive = Layer.effect(
  Operations,
  Effect.gen(function* () {
    const execution = yield* ExecutionContext;
    const session = yield* SessionContext;
    const filesystem = yield* Filesystem;
    const clock = yield* Clock.Clock;
    const changed =
      yield* scopedEvent<
        RoutedNotification<OperationNamespaceEvents["changed"]>
      >();
    const forkOperation = yield* FiberSet.makeRuntime<
      never,
      unknown,
      unknown
    >();
    const records = new Map<string, RecordEntry>();
    const requests = new Map<string, string>();
    const quota = createOperationQuota();
    const closedSessions = new Map<string, string>();
    let accepting = true;
    let shuttingDown = false;
    let runtimeTransition: string | undefined;
    yield* Effect.addFinalizer(() =>
      shutdown().pipe(
        Effect.ensuring(
          Effect.sync(() => {
            records.clear();
            requests.clear();
            quota.clear();
          }),
        ),
      ),
    );
    yield* Effect.forkScoped(
      Effect.schedule(
        Effect.sync(prune),
        Schedule.spaced(Duration.seconds(60)),
      ),
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
        throw new InvalidOperationRequestKey({ requestKey });
      const requestIdentity = canonical([sessionId, owner.appId, requestKey]);
      const fingerprint = createHash("sha256")
        .update(canonical([command, args]))
        .digest("hex");
      if (requestKey !== undefined) {
        const previousId = requests.get(requestIdentity);
        const previous = previousId && records.get(previousId);
        if (previous) {
          if (previous.fingerprint !== fingerprint)
            throw new OperationRequestConflict({ command, requestKey });
          return { command, id: previous.snapshot.id };
        }
      }
      if (!accepting || closedSessions.has(sessionId))
        throw new OperationAdmissionClosed({ sessionId });
      quota.reserve(owner.appId);
      let retained = false;
      let task: OperationTask<unknown> | undefined;
      let id: string | undefined;
      let transitionSessionId: string | undefined;
      try {
        task = prepare();
        if (!task || typeof task.run !== "function" || "then" in task)
          throw new Error(
            "Operation handlers must synchronously prepare a task",
          );
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
            throw new SessionTransitionInProgress({
              sessionId: transitionSessionId,
            });
          closedSessions.set(transitionSessionId, id);
        }
        if (task.transition === "runtime") {
          accepting = false;
          runtimeTransition = id;
        }
        const now = clock.currentTimeMillisUnsafe();
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
          fiber: forkOperation(
            execution.provide(
              Effect.andThen(
                afterResponse,
                Effect.suspend(() => execute(record, prepared)),
              ),
              capturedContext,
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
    function runHost<R, E, P>(
      command: string,
      args: unknown,
      prepare: Effect.Effect<OperationTask<R, E>, P>,
    ): Effect.Effect<R, E | P | HostOperationFailure> {
      return Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const context: CommandCallerContext = {
            principal: { kind: "system" },
            sessionId: session.getSessionId(),
          };
          const task = yield* restore(prepare);
          const handle = yield* Effect.try({
            try: () => submit(command, args, context, () => task),
            catch: (error) => {
              if (
                error instanceof InvalidOperationRequestKey ||
                error instanceof OperationRequestConflict ||
                error instanceof OperationAdmissionClosed ||
                error instanceof OperationCapacityExhausted ||
                error instanceof SessionTransitionInProgress
              )
                return error;
              throw error;
            },
          }).pipe(Effect.onError(() => Effect.sync(() => task.release?.())));
          // This handle was just submitted from this exact task, so its retained
          // result/failure types are known despite the heterogeneous ledger.
          return yield* restore(
            // @effect-diagnostics-next-line unsafeEffectTypeAssertion:off -- This newly admitted host handle belongs to the typed task above; the shared ledger erases heterogeneous results.
            wait(handle, context) as Effect.Effect<R, E | OperationCancelled>,
          );
        }),
      );
    }
    const execute = Effect.fn(function* (
      record: RecordEntry,
      task: OperationTask<unknown>,
    ) {
      update(record, {
        status: "running",
        startedAt: clock.currentTimeMillisUnsafe(),
      });
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
            completedAt: clock.currentTimeMillisUnsafe(),
            result: exit.value,
          });
        } else if (Cause.hasInterruptsOnly(exit.cause)) {
          update(record, {
            status: "cancelled",
            completedAt: clock.currentTimeMillisUnsafe(),
          });
        } else {
          const failure = asError(Cause.squash(exit.cause));
          const typedFailure = Cause.findErrorOption(exit.cause);
          const encodable =
            !Cause.hasDies(exit.cause) && !Cause.hasInterrupts(exit.cause);
          update(record, {
            status: "failed",
            completedAt: clock.currentTimeMillisUnsafe(),
            error: { name: failure.name, message: failure.message },
            ...(task.encodeFailure && encodable && Option.isSome(typedFailure)
              ? {
                  response: structuredClone(
                    task.encodeFailure(typedFailure.value),
                  ),
                }
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
        updatedAt: clock.currentTimeMillisUnsafe(),
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
        throw new OperationNotFound({ handle });
      return structuredClone(record.snapshot);
    }
    function cancel(
      handle: OperationHandle,
      context = execution.get() ?? {},
    ): void {
      const snapshot = get(handle, context);
      if (snapshot.status !== "queued" && snapshot.status !== "running") return;
      const record = records.get(handle.id)!;
      if (!snapshot.cancellable) throw new OperationNotCancellable({ handle });
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
            return Effect.fail(new OperationCancelled({ handle }));
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
    ): Effect.Effect<
      A,
      E | OperationAdmissionClosed | SessionTransitionInProgress
    > {
      return Effect.suspend<
        A,
        E | OperationAdmissionClosed | SessionTransitionInProgress,
        never
      >(() => {
        const sessionId = session.getSessionId();
        const operationId = execution.get()?.operationId;
        const reserved = closedSessions.get(sessionId);
        if (reserved)
          return reserved === operationId
            ? work
            : Effect.fail(new SessionTransitionInProgress({ sessionId }));
        if (!accepting)
          return Effect.fail(new OperationAdmissionClosed({ sessionId }));
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
    function closeAdmission() {
      shuttingDown = true;
      accepting = false;
    }
    function shutdown(): Effect.Effect<void> {
      return Effect.gen(function* () {
        closeAdmission();
        yield* drain(execution.get()?.operationId);
      });
    }
    function prune(): void {
      const now = clock.currentTimeMillisUnsafe();
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
      drain,
      closeAdmission,
      shutdown,
    };
  }),
);

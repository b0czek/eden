import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type {
  OperationHandle,
  OperationSnapshot,
  OperationSubmission,
} from "@edenapp/types";
import { delay, inject, Lifecycle, scoped } from "tsyringe";
import {
  ExecutionContext,
  type CommandCallerContext,
} from "../execution/ExecutionContext";
import { EdenEmitter } from "../ipc/EdenEmitter";
import { EdenNamespace } from "../ipc/CommandDecorators";
import type { IPCBridge } from "../ipc/IPCBridge";
import { SessionContext } from "../session/SessionContext";
import type { OperationTask } from "./OperationTask";

interface OperationNamespaceEvents {
  changed: { snapshot: OperationSnapshot };
}

interface RecordEntry {
  snapshot: OperationSnapshot;
  owner: { appId?: string; sessionId: string };
  context: CommandCallerContext;
  done: Promise<void>;
  finish: () => void;
  requestKey?: string;
  fingerprint: string;
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

@scoped(Lifecycle.ContainerScoped)
@EdenNamespace("operation")
export class OperationManager extends EdenEmitter<OperationNamespaceEvents> {
  private readonly records = new Map<string, RecordEntry>();
  private readonly requests = new Map<string, string>();
  private readonly closedSessions = new Map<string, string>();
  private accepting = true;
  private shuttingDown = false;
  private runtimeTransition?: string;
  private readonly expiryTimer: NodeJS.Timeout;
  static readonly retentionMs = 15 * 60 * 1000;
  static readonly completedLimit = 256;

  constructor(
    @inject(delay(() => require("../ipc/IPCBridge").IPCBridge))
    bridge: IPCBridge,
    @inject(ExecutionContext) private execution: ExecutionContext,
    @inject(SessionContext) private session: SessionContext,
  ) {
    super(bridge);
    this.expiryTimer = setInterval(() => this.prune(), 60_000);
    this.expiryTimer.unref();
  }

  submit(
    command: string,
    args: unknown,
    context: CommandCallerContext,
    prepare: () => OperationTask<unknown>,
    submission: OperationSubmission = {},
  ): OperationHandle {
    this.prune();
    const sessionId = context.sessionId ?? this.session.getSessionId();
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
    const fingerprint = canonical([command, args]);
    if (requestKey !== undefined) {
      const previousId = this.requests.get(requestIdentity);
      const previous = previousId && this.records.get(previousId);
      if (previous) {
        if (previous.fingerprint !== fingerprint)
          throw new Error(
            "Operation request key reused with different command or arguments",
          );
        return { command, id: previous.snapshot.id };
      }
    }
    if (!this.accepting || this.closedSessions.has(sessionId))
      throw new Error("Operations are draining; new submissions are closed");
    const task = prepare();
    if (!task || typeof task.run !== "function" || "then" in task)
      throw new Error("Operation handlers must synchronously prepare a task");
    const id = randomUUID();
    if (task.transition === "session") this.closedSessions.set(sessionId, id);
    if (task.transition === "runtime") {
      this.accepting = false;
      this.runtimeTransition = id;
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
        revision: 1,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      },
      owner,
      context: { ...context, sessionId, operationId: id },
      done,
      finish,
      fingerprint,
      requestKey: requestKey === undefined ? undefined : requestIdentity,
    };
    this.records.set(id, record);
    if (record.requestKey) this.requests.set(record.requestKey, id);
    this.publish(record);
    // IPC response delivery is queued before tasks may tear down their caller.
    setImmediate(() => {
      void this.execution.run(record.context, () => this.execute(record, task));
    });
    return { command, id };
  }

  private async execute(
    record: RecordEntry,
    task: OperationTask<unknown>,
  ): Promise<void> {
    this.update(record, { status: "running", startedAt: Date.now() });
    try {
      if (task.transition === "session")
        await this.drainSession(record.owner.sessionId, record.snapshot.id);
      if (task.transition === "runtime") await this.drain(record.snapshot.id);
      const result = await task.run({
        update: (phase, progress) => this.update(record, { phase, progress }),
      });
      const failed = task.isFailure
        ? task.isFailure(result)
        : result === false ||
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
        this.update(record, {
          status: "failed",
          completedAt: Date.now(),
          error: { name: "OperationError", message },
          response: result,
        });
      } else
        this.update(record, {
          status: "succeeded",
          completedAt: Date.now(),
          result,
        });
    } catch (error) {
      this.update(record, {
        status: "failed",
        completedAt: Date.now(),
        error: {
          name: error instanceof Error ? error.name : "Error",
          message: error instanceof Error ? error.message : "Operation failed",
        },
      });
    } finally {
      if (
        task.transition === "session" &&
        this.closedSessions.get(record.owner.sessionId) === record.snapshot.id
      )
        this.closedSessions.delete(record.owner.sessionId);
      if (
        task.transition === "runtime" &&
        this.runtimeTransition === record.snapshot.id
      ) {
        this.runtimeTransition = undefined;
        this.accepting = !this.shuttingDown;
      }
      record.finish();
      this.prune();
    }
  }

  private update(record: RecordEntry, patch: Record<string, unknown>): void {
    record.snapshot = {
      ...record.snapshot,
      ...patch,
      revision: record.snapshot.revision + 1,
      updatedAt: Date.now(),
    } as OperationSnapshot;
    this.publish(record);
  }

  private publish(record: RecordEntry): void {
    this.notify(
      "changed",
      { snapshot: structuredClone(record.snapshot) },
      record.owner,
    );
  }

  private authorized(
    record: RecordEntry,
    context: CommandCallerContext,
  ): boolean {
    return (
      record.owner.appId === context.appId &&
      record.owner.sessionId ===
        (context.sessionId ?? this.session.getSessionId())
    );
  }

  get(
    handle: OperationHandle,
    context = this.execution.get() ?? {},
  ): OperationSnapshot {
    this.prune();
    const record = this.records.get(handle.id);
    if (
      !record ||
      record.snapshot.command !== handle.command ||
      !this.authorized(record, context)
    )
      throw new Error("Operation not found or access denied");
    return structuredClone(record.snapshot);
  }

  list(context = this.execution.get() ?? {}): OperationSnapshot[] {
    this.prune();
    return [...this.records.values()]
      .filter((record) => this.authorized(record, context))
      .map((record) => structuredClone(record.snapshot));
  }

  async wait(
    handle: OperationHandle,
    context = this.execution.get() ?? {},
  ): Promise<unknown> {
    this.get(handle, context);
    const record = this.records.get(handle.id)!;
    await record.done;
    const snapshot = record.snapshot;
    if (snapshot.status === "succeeded")
      return structuredClone(snapshot.result);
    if (snapshot.status === "failed") {
      if ("response" in snapshot) return structuredClone(snapshot.response);
      const error = new Error(snapshot.error.message);
      error.name = snapshot.error.name;
      throw error;
    }
    throw new Error("Operation has not completed");
  }

  /** Privileged read-only host snapshots. */
  inspect(handle: OperationHandle): OperationSnapshot | undefined {
    this.prune();
    const record = this.records.get(handle.id);
    return record?.snapshot.command === handle.command
      ? structuredClone(record.snapshot)
      : undefined;
  }

  inspectAll(): OperationSnapshot[] {
    this.prune();
    return [...this.records.values()].map((record) =>
      structuredClone(record.snapshot),
    );
  }

  async drainSession(sessionId: string, excludeId?: string): Promise<void> {
    await Promise.all(
      [...this.records.values()]
        .filter(
          (record) =>
            record.owner.sessionId === sessionId &&
            record.snapshot.id !== excludeId,
        )
        .map((record) => record.done),
    );
  }

  async withSessionTransition<T>(task: () => Promise<T>): Promise<T> {
    const sessionId = this.session.getSessionId();
    const operationId = this.execution.get()?.operationId;
    const reserved = this.closedSessions.get(sessionId);
    if (reserved && reserved !== operationId)
      throw new Error("A session transition is already in progress");
    const reservation = operationId ?? randomUUID();
    this.closedSessions.set(sessionId, reservation);
    try {
      await this.drainSession(sessionId, operationId);
      return await task();
    } finally {
      if (this.closedSessions.get(sessionId) === reservation)
        this.closedSessions.delete(sessionId);
    }
  }

  async drain(excludeId?: string): Promise<void> {
    await Promise.all(
      [...this.records.values()]
        .filter((record) => record.snapshot.id !== excludeId)
        .map((record) => record.done),
    );
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    this.accepting = false;
    await this.drain(this.execution.get()?.operationId);
  }

  private prune(): void {
    const completed = [...this.records.values()].filter(
      (record) =>
        record.snapshot.status === "succeeded" ||
        record.snapshot.status === "failed",
    );
    completed.sort(
      (a, b) =>
        (a.snapshot as { completedAt: number }).completedAt -
        (b.snapshot as { completedAt: number }).completedAt,
    );
    const now = Date.now();
    for (let index = 0; index < completed.length; index++) {
      const record = completed[index];
      if (
        index < completed.length - OperationManager.completedLimit ||
        now - (record.snapshot as { completedAt: number }).completedAt >=
          OperationManager.retentionMs
      ) {
        this.records.delete(record.snapshot.id);
        if (record.requestKey) this.requests.delete(record.requestKey);
      }
    }
  }

  override dispose(): void {
    clearInterval(this.expiryTimer);
    this.records.clear();
    this.requests.clear();
    super.dispose();
  }
}

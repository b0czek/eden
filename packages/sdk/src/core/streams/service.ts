import { randomUUID } from "node:crypto";
import type { StreamHandle } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import type * as Fiber from "effect/Fiber";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { log } from "../../platform/logging/logger";
import { asError } from "../effects/io";
import type { Event } from "../events/event";
import { scopedEvent } from "../events/scoped";
import {
  type CommandCallerContext,
  ExecutionContext,
} from "../execution/context";
import {
  StreamAdmissionClosed,
  StreamCapacityExhausted,
  StreamOwnerUnavailable,
} from "./errors";
import { STREAM_WINDOW, type StreamMessage } from "./protocol";

/** The caller that receives a stream's messages; streams end when it closes. */
export type StreamOwner =
  | { kind: "view"; webContentsId: number }
  | { kind: "backend"; appId: string };

export interface StreamDelivery {
  owner: StreamOwner;
  message: StreamMessage;
}

export interface Streams {
  /** Messages for the IPC transport to deliver to each stream's owner. */
  messages: Event<StreamDelivery>;
  /** Synchronous admission; throws StreamOwnerUnavailable, StreamCapacityExhausted, or StreamAdmissionClosed. */
  open: (
    command: string,
    context: CommandCallerContext,
    source: Stream.Stream<unknown, unknown>,
  ) => StreamHandle;
  /** Return credit for consumed chunks. Ignores finished streams and other callers' streams. */
  acknowledge: (
    handle: StreamHandle,
    count: number,
    context?: CommandCallerContext,
  ) => Effect.Effect<void>;
  /** Stop a stream, then send its end message. Ignores finished streams and other callers' streams. */
  cancel: (handle: StreamHandle, context?: CommandCallerContext) => void;
  /** Stop an owner's streams without messages after its view or backend closes. */
  closeOwner: (owner: StreamOwner) => void;
}

export const Streams = Context.Service<"eden/Streams", Streams>("eden/Streams");

export const streamCapacityPerOwner = 16;

interface StreamRecord {
  handle: StreamHandle;
  owner: StreamOwner;
  credits: Semaphore.Semaphore;
  /** Chunks sent and not yet acknowledged; bounds the credit a reader can return. */
  outstanding: number;
  silent: boolean;
  fiber?: Fiber.Fiber<void>;
}

function ownerOf(context: CommandCallerContext): StreamOwner | undefined {
  if (context.foundation) return undefined;
  if (context.webContentsId !== undefined)
    return { kind: "view", webContentsId: context.webContentsId };
  if (context.appId) return { kind: "backend", appId: context.appId };
  return undefined;
}

function sameOwner(left: StreamOwner, right: StreamOwner | undefined) {
  if (left.kind === "view")
    return right?.kind === "view" && right.webContentsId === left.webContentsId;
  return right?.kind === "backend" && right.appId === left.appId;
}

export const StreamsLive = Layer.effect(
  Streams,
  Effect.gen(function* () {
    const execution = yield* ExecutionContext;
    const messages = yield* scopedEvent<StreamDelivery>();
    const forkStream = yield* FiberSet.makeRuntime<never, void, never>();
    const records = new Map<string, StreamRecord>();
    let closing = false;
    // Runs before the FiberSet interrupts streams, so shutdown sends no messages.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        closing = true;
      }),
    );

    function send(record: StreamRecord, message: StreamMessage) {
      messages.emit({ owner: record.owner, message });
    }

    function finish(record: StreamRecord, exit: Exit.Exit<void, unknown>) {
      records.delete(record.handle.id);
      if (record.silent || closing) return;
      const { id } = record.handle;
      if (Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)) {
        send(record, { id, kind: "end" });
        return;
      }
      const error = asError(Cause.squash(exit.cause));
      log.error(`Stream ${record.handle.command} failed:`, error.message);
      send(record, {
        id,
        kind: "error",
        error: { name: error.name, message: error.message },
      });
    }

    function open(
      command: string,
      context: CommandCallerContext,
      source: Stream.Stream<unknown, unknown>,
    ): StreamHandle {
      if (closing) throw new StreamAdmissionClosed({ command });
      const owner = ownerOf(context);
      if (!owner) throw new StreamOwnerUnavailable({ command });
      let owned = 0;
      for (const record of records.values())
        if (sameOwner(record.owner, owner)) owned += 1;
      if (owned >= streamCapacityPerOwner)
        throw new StreamCapacityExhausted({
          command,
          capacity: streamCapacityPerOwner,
        });
      const handle = { command, id: randomUUID() };
      const record: StreamRecord = {
        handle,
        owner,
        credits: Semaphore.makeUnsafe(STREAM_WINDOW),
        outstanding: 0,
        silent: false,
      };
      records.set(handle.id, record);
      const run = Stream.runForEach(source, (chunk) =>
        Effect.andThen(
          record.credits.take(1),
          Effect.sync(() => {
            record.outstanding += 1;
            send(record, { id: handle.id, kind: "chunk", chunk });
          }),
        ),
      );
      record.fiber = forkStream(
        Effect.asVoid(
          Effect.exit(
            execution
              .provide(run, context)
              .pipe(
                Effect.onExit((exit) =>
                  Effect.sync(() => finish(record, exit)),
                ),
              ),
          ),
        ),
      );
      return { ...handle };
    }

    function owned(handle: StreamHandle, context: CommandCallerContext) {
      const record = records.get(handle.id);
      return record?.handle.command === handle.command &&
        sameOwner(record.owner, ownerOf(context))
        ? record
        : undefined;
    }

    function acknowledge(
      handle: StreamHandle,
      count: number,
      context = execution.get() ?? {},
    ): Effect.Effect<void> {
      return Effect.suspend(() => {
        const record = owned(handle, context);
        const granted = Math.min(Math.max(count, 0), record?.outstanding ?? 0);
        if (!record || granted === 0) return Effect.void;
        record.outstanding -= granted;
        return Effect.asVoid(record.credits.release(granted));
      });
    }

    function cancel(
      handle: StreamHandle,
      context = execution.get() ?? {},
    ): void {
      owned(handle, context)?.fiber?.interruptUnsafe();
    }

    function closeOwner(owner: StreamOwner): void {
      for (const record of [...records.values()]) {
        if (!sameOwner(record.owner, owner)) continue;
        record.silent = true;
        record.fiber?.interruptUnsafe();
      }
    }

    return {
      messages,
      open,
      acknowledge,
      cancel,
      closeOwner,
    } satisfies Streams;
  }),
);

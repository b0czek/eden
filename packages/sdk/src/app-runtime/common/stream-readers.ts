import type { StreamHandle, StreamReader } from "@edenapp/types";
import {
  STREAM_ACK_BATCH,
  type StreamFailure,
  type StreamMessage,
} from "../../core/streams/protocol";
import { log } from "../../platform/logging/logger";
import type { ShellTransport } from "./shell-transport";

interface ReaderState {
  handle?: StreamHandle;
  chunks: unknown[];
  terminal?: { kind: "end" } | { kind: "error"; error: StreamFailure };
  closed: boolean;
  unacknowledged: number;
  wake?: () => void;
  reading: Promise<unknown>;
}

function streamError(failure: StreamFailure): Error {
  const error = new Error(failure.message);
  error.name = failure.name;
  return error;
}

/**
 * Own app-side stream state. Messages can arrive before the command response,
 * so each stream buffers until its reader opens; credit bounds that buffer.
 */
export function createStreamReaders(transport: ShellTransport) {
  const states = new Map<string, ReaderState>();

  function state(id: string): ReaderState {
    let entry = states.get(id);
    if (!entry) {
      entry = {
        chunks: [],
        closed: false,
        unacknowledged: 0,
        reading: Promise.resolve(),
      };
      states.set(id, entry);
    }
    return entry;
  }

  function wake(entry: ReaderState): void {
    const resume = entry.wake;
    entry.wake = undefined;
    resume?.();
  }

  function dispatch(message: StreamMessage): void {
    const entry = state(message.id);
    if (entry.closed) {
      // A cancelled stream still sends its end; only then is its state released.
      if (message.kind !== "chunk") states.delete(message.id);
      return;
    }
    if (message.kind === "chunk") entry.chunks.push(message.chunk);
    else entry.terminal = message;
    wake(entry);
  }

  function acknowledge(handle: StreamHandle, entry: ReaderState): void {
    entry.unacknowledged += 1;
    if (entry.unacknowledged < STREAM_ACK_BATCH) return;
    const count = entry.unacknowledged;
    entry.unacknowledged = 0;
    transport
      .exec("stream/ack", { handle, count })
      .catch((error) =>
        log.warn(`Failed to acknowledge stream ${handle.command}:`, error),
      );
  }

  function open<C extends string>(handle: StreamHandle<C>): StreamReader<C> {
    const target = { command: handle.command, id: handle.id };
    const entry = state(target.id);
    entry.handle = target;

    const read = async (): Promise<IteratorResult<unknown, undefined>> => {
      while (true) {
        if (entry.closed) return { done: true, value: undefined };
        if (entry.chunks.length) {
          const value = entry.chunks.shift();
          acknowledge(target, entry);
          return { done: false, value };
        }
        const terminal = entry.terminal;
        if (terminal) {
          entry.closed = true;
          states.delete(target.id);
          if (terminal.kind === "error") throw streamError(terminal.error);
          return { done: true, value: undefined };
        }
        await new Promise<void>((resolve) => {
          entry.wake = resolve;
        });
      }
    };

    return {
      handle: { ...target },
      next: () => {
        const result = entry.reading.then(read);
        entry.reading = result.catch(() => undefined);
        return result as ReturnType<StreamReader<C>["next"]>;
      },
      cancel: async () => {
        if (entry.closed) return;
        entry.closed = true;
        entry.chunks = [];
        wake(entry);
        if (entry.terminal) {
          states.delete(target.id);
          return;
        }
        await transport.exec("stream/cancel", { handle: target });
      },
    };
  }

  return { open, dispatch };
}

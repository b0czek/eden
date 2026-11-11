/** Shared by the main process and preloads; keep free of runtime Effect dependencies. */

/** Renderer IPC channel and backend message type that carry stream messages. */
export const STREAM_CHANNEL = "shell-stream";

/** Chunks a stream may send before its reader acknowledges them. */
export const STREAM_WINDOW = 32;

/** Readers acknowledge consumed chunks in batches no larger than the window. */
export const STREAM_ACK_BATCH = STREAM_WINDOW / 2;

export interface StreamFailure {
  name: string;
  message: string;
}

/** Each stream sends chunks in order and at most one terminal message. */
export type StreamMessage = { id: string } & (
  | { kind: "chunk"; chunk: unknown }
  | { kind: "end" }
  | { kind: "error"; error: StreamFailure }
);

import type { CommandChunk, CommandName } from "./commands";

export interface StreamHandle<C extends string = string> {
  command: C;
  id: string;
}

export interface StreamCommand<A, T, C extends string = string> {
  mode: "stream";
  args: A;
  response: StreamHandle<C>;
  chunk: T;
}

/** Known commands retain their chunk type; other handles read unknown values. */
export type StreamChunk<C extends string> = C extends CommandName
  ? CommandChunk<C>
  : unknown;

/** App-side reader for one stream command. Read chunks in order, or cancel. */
export interface StreamReader<C extends string = string> {
  readonly handle: StreamHandle<C>;
  /**
   * Resolve with the next chunk, or with `done` after the stream ends or is cancelled.
   * Reject when the stream fails.
   */
  next(): Promise<IteratorResult<StreamChunk<C>, undefined>>;
  /** Stop the stream. Waiting and later `next()` calls resolve with `done`. */
  cancel(): Promise<void>;
}

/** A stream reader that `for await` can consume. Leaving the loop early cancels it. */
export interface CommandStream<C extends string = string>
  extends StreamReader<C>,
    AsyncIterable<StreamChunk<C>, undefined> {}

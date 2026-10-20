import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** Releases session-owned capabilities before draining accepted operations. */
export interface OperationsFilesystem {
  releaseHandles(sessionId?: string): Effect.Effect<void, Error>;
}
export const OperationsFilesystem = Context.Service<
  "eden/OperationsFilesystem",
  OperationsFilesystem
>("eden/OperationsFilesystem");

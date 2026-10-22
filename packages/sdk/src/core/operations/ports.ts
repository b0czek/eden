import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

/** Awaited system preparation after admission closes and before operations drain. */
export interface OperationTransitionPreparation {
  prepareSession(sessionId: string): Effect.Effect<void>;
  prepareRuntime(): Effect.Effect<void>;
}

export const OperationTransitionPreparation = Context.Service<
  "eden/OperationTransitionPreparation",
  OperationTransitionPreparation
>("eden/OperationTransitionPreparation");

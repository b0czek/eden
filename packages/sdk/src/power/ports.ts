import type { EdenPowerCapabilities } from "@edenapp/types";
import type * as Effect from "effect/Effect";

export type PowerAction = "poweroff" | "reboot";

export interface PowerHost {
  getCapabilities(): EdenPowerCapabilities;
  perform(action: PowerAction): Effect.Effect<void, Error>;
}

export interface PowerShutdown {
  shutdown(): Effect.Effect<void, Error>;
}

/** Retained operations interpret service work only after admission succeeds. */
export interface PowerOperationBoundary {
  run<A, E>(work: Effect.Effect<A, E>): Promise<A>;
}

import type { EdenPowerCapabilities } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { PowerAction } from "./types";

/** Trusted host integration; failures are translated at the power boundary. */
export interface PowerHost {
  getCapabilities(): EdenPowerCapabilities;
  perform(action: PowerAction): Effect.Effect<void, Error>;
}

export const PowerHost = Context.Service<
  "eden/PowerHost",
  PowerHost | undefined
>("eden/PowerHost");

export interface PowerShutdown {
  shutdown(): Effect.Effect<void, Error>;
}

export const PowerDaemons = Context.Service<"eden/PowerDaemons", PowerShutdown>(
  "eden/PowerDaemons",
);

export const PowerProcesses = Context.Service<
  "eden/PowerProcesses",
  PowerShutdown
>("eden/PowerProcesses");

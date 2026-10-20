import * as Context from "effect/Context";

/** Runtime routing consumes process membership and releases backend audiences. */
export interface ProcessesRouting {
  updateRunningApps(appIds: Iterable<string>): void;
  removeBackendSubscriptions(appId: string): void;
}

export const ProcessesRouting = Context.Service<
  "eden/ProcessesRouting",
  ProcessesRouting
>("eden/ProcessesRouting");

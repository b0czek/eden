import * as Data from "effect/Data";
import type { ViewCreateError } from "../views/errors";

/** Synchronous admission and launch invariants owned by processes. */
export class ProcessLaunchRejected extends Data.TaggedError(
  "ProcessLaunchRejected",
)<{
  appId: string;
  reason:
    | "forbidden"
    | "not-installed"
    | "invalid-entry"
    | "not-daemon"
    | "already-running"
    | "missing-path"
    | "shutting-down";
  message: string;
}> {}

export class ProcessNotRunning extends Data.TaggedError("ProcessNotRunning")<{
  appId: string;
  message: string;
}> {}

export class BackendRejected extends Data.TaggedError("BackendRejected")<{
  appId: string;
  reason: "already-running" | "missing-entry";
  message: string;
}> {}

export class BackendIoFailed extends Data.TaggedError("BackendIoFailed")<{
  appId: string;
  operation: "spawn" | "connect" | "terminate";
  cause: unknown;
  message: string;
}> {}

export class BackendStartupFailed extends Data.TaggedError(
  "BackendStartupFailed",
)<{
  appId: string;
  reason: "reported-error" | "exited" | "timeout";
  message: string;
  code?: number;
}> {}

export class BackendTerminationTimedOut extends Data.TaggedError(
  "BackendTerminationTimedOut",
)<{
  appId: string;
  message: string;
}> {}

export class ProcessMetricsFailed extends Data.TaggedError(
  "ProcessMetricsFailed",
)<{
  cause: unknown;
  message: string;
}> {}

export class ProcessMetricsStopped extends Data.TaggedError(
  "ProcessMetricsStopped",
)<{
  message: string;
}> {}
export type ProcessMetricsError = ProcessMetricsFailed | ProcessMetricsStopped;

export type BackendCreateError =
  | BackendRejected
  | BackendIoFailed
  | BackendStartupFailed;
export type BackendTerminateError =
  | BackendIoFailed
  | BackendTerminationTimedOut;
export type ProcessLaunchError =
  | ProcessLaunchRejected
  | ViewCreateError
  | BackendCreateError;

export class ProcessStopFailed extends Data.TaggedError("ProcessStopFailed")<{
  appId: string;
  cause: unknown;
  message: string;
}> {}

export class SessionProcessesStopFailed extends Data.TaggedError(
  "SessionProcessesStopFailed",
)<{
  sessionId: string;
  cause: AggregateError;
  message: string;
}> {}

export type ProcessStopError = ProcessNotRunning | ProcessStopFailed;

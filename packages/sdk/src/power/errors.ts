import * as Data from "effect/Data";
import type { PowerAction } from "./types";

export class PowerDisposed extends Data.TaggedError("PowerDisposed") {
  override readonly message = "Power service disposed";
}

export class PowerPending extends Data.TaggedError("PowerPending") {
  override readonly message = "A system power action is already pending";
}

export class PowerUnavailable extends Data.TaggedError("PowerUnavailable")<{
  readonly action: PowerAction;
  readonly reason: "host" | "action";
}> {
  override get message() {
    return this.reason === "host"
      ? "System power management is unavailable"
      : `System ${this.action} is unavailable`;
  }
}

export class PowerHandoffFailed extends Data.TaggedError("PowerHandoffFailed")<{
  readonly action: PowerAction;
  readonly cause: Error;
}> {
  override get message() {
    return this.cause.message;
  }
}

export type PowerAdmissionError =
  | PowerDisposed
  | PowerPending
  | PowerUnavailable;
export type PowerError = PowerAdmissionError | PowerHandoffFailed;

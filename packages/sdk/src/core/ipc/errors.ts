import * as Data from "effect/Data";
import * as v from "valibot";

export class UnknownCommand extends Data.TaggedError("UnknownCommand")<{
  command: string;
}> {
  override readonly name = "Error";

  override get message() {
    return `Unknown command: ${this.command}`;
  }
}

export class CommandPermissionDenied extends Data.TaggedError(
  "CommandPermissionDenied",
)<{ command: string; permission: string; appId: string }> {
  override readonly name = "Error";

  override get message() {
    return `Permission denied: ${this.permission} required for ${this.command}`;
  }
}

export class CommandGrantDenied extends Data.TaggedError("CommandGrantDenied")<{
  command: string;
  grantKeys: string[];
  appId: string;
}> {
  override readonly name = "Error";

  override get message() {
    return `Grant denied: ${this.grantKeys.join(",")} required for ${this.command}`;
  }
}

export class CallerPrincipalUnavailable extends Data.TaggedError(
  "CallerPrincipalUnavailable",
)<{ appId: string }> {
  override readonly name = "Error";

  override get message() {
    return `Caller principal could not be resolved for app ${this.appId}`;
  }
}

export class FoundationAccessDenied extends Data.TaggedError(
  "FoundationAccessDenied",
)<{ resource: string; action: "execute" | "subscribe to" }> {
  override readonly name = "Error";

  override get message() {
    return `Foundation is not allowed to ${this.action} ${this.resource}`;
  }
}

export class EventPermissionDenied extends Data.TaggedError(
  "EventPermissionDenied",
)<{ eventName: string; permission: string; appId: string }> {
  override readonly name = "Error";

  override get message() {
    return `Permission denied: ${this.permission} required to subscribe to ${this.eventName}`;
  }
}

export class EventSubscriptionRejected extends Data.TaggedError(
  "EventSubscriptionRejected",
)<{ eventName: string; message: string }> {
  override readonly name = "Error";
}

/** Domain admission errors carry an explicit tag; untagged throws are defects. */
export function isCommandRejection(error: unknown): error is Error {
  return (
    v.isValiError(error) ||
    (error instanceof Error &&
      "_tag" in error &&
      typeof error._tag === "string")
  );
}

import * as Data from "effect/Data";

export class AppServiceAlreadyRegistered extends Data.TaggedError(
  "AppServiceAlreadyRegistered",
)<{ readonly appId: string; readonly serviceName: string }> {
  override get message() {
    return `Service "${this.serviceName}" is already registered by app "${this.appId}"`;
  }
}

export class AppChannelCallerRequired extends Data.TaggedError(
  "AppChannelCallerRequired",
) {
  override get message() {
    return "AppBus access requires a caller app identity";
  }
}

/** A native transport operation failed while establishing a channel. */
export class AppChannelFailure extends Data.TaggedError("AppChannelFailure")<{
  readonly operation:
    | "lookup-requester"
    | "lookup-provider"
    | "create-channel"
    | "transfer-requester"
    | "transfer-provider";
  readonly requesterAppId: string;
  readonly targetAppId: string;
  readonly serviceName: string;
  readonly cause: unknown;
}> {
  override get message() {
    return `AppBus ${this.operation} failed for "${this.targetAppId}:${this.serviceName}"`;
  }
}

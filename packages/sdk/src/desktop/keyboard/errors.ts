import * as Data from "effect/Data";

/** Expected native window I/O failure; preserve the renderer-visible message. */
export class KeyboardNativeFailure extends Data.TaggedError(
  "KeyboardNativeFailure",
)<{
  operation:
    | "attach-main-window"
    | "create-overlay"
    | "load-frontend"
    | "set-scale"
    | "set-bounds"
    | "set-movable"
    | "show"
    | "hide"
    | "send-state";
  cause: unknown;
}> {
  get message(): string {
    return this.cause instanceof Error
      ? this.cause.message
      : String(this.cause);
  }
}

export class KeyboardSenderRejected extends Data.TaggedError(
  "KeyboardSenderRejected",
)<{
  sender: number;
  operation: "dispatch-actions" | "start-drag" | "end-drag";
}> {
  get message(): string {
    if (this.operation === "dispatch-actions")
      return "Only the keyboard window can dispatch keyboard actions";
    return `Only the keyboard window can ${this.operation === "start-drag" ? "start" : "end"} keyboard drag`;
  }
}

import * as Data from "effect/Data";

export class NotificationsClosed extends Data.TaggedError(
  "NotificationsClosed",
)<{
  message: string;
}> {}

export class NotificationCallerRejected extends Data.TaggedError(
  "NotificationCallerRejected",
)<{
  operation: "register-display" | "actions" | "dismissals";
  appId?: string;
  webContentsId?: number;
  message: string;
}> {}

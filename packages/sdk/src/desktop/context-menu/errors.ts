import * as Data from "effect/Data";

export class ContextMenuCallerRejected extends Data.TaggedError(
  "ContextMenuCallerRejected",
)<{
  operation: "register-display" | "open" | "close";
  appId?: string;
  webContentsId?: number;
  requestId?: string;
  message: string;
}> {}

export class ContextMenuViewReadFailed extends Data.TaggedError(
  "ContextMenuViewReadFailed",
)<{
  viewId: number;
  message: string;
  cause: unknown;
}> {}

export type ContextMenuOpenFailure =
  | ContextMenuCallerRejected
  | ContextMenuViewReadFailed;
export type ContextMenuCloseFailure =
  | ContextMenuCallerRejected
  | ContextMenuViewReadFailed;

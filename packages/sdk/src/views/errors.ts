import type { TileLayoutDirection } from "@edenapp/types";
import * as Data from "effect/Data";
import * as Result from "effect/Result";
import type { ViewMode } from "./types";

/** The requested renderer no longer exists. */
export class ViewUnavailable extends Data.TaggedError("ViewUnavailable")<{
  viewId?: number;
  appId?: string;
  reason: "missing" | "destroyed";
}> {
  get message(): string {
    return this.viewId !== undefined
      ? `View ${this.viewId} ${this.reason === "missing" ? "not found" : "is destroyed"}`
      : `View for app ${this.appId} ${this.reason === "missing" ? "not found" : "is destroyed"}`;
  }
}

export class MainWindowUnavailable extends Data.TaggedError(
  "MainWindowUnavailable",
)<{
  appId: string;
}> {
  get message(): string {
    return "Main window not set. Call setMainWindow first.";
  }
}

export class ViewModeUnsupported extends Data.TaggedError(
  "ViewModeUnsupported",
)<{
  viewId: number;
  appId: string;
  supportedMode: ViewMode;
  requestedMode: ViewMode;
}> {
  get message(): string {
    return `App ${this.appId} only supports ${this.supportedMode} mode`;
  }
}

export class TileActionUnavailable extends Data.TaggedError(
  "TileActionUnavailable",
)<{
  viewId: number;
  action: "swap" | "expand";
  direction: TileLayoutDirection;
}> {
  get message(): string {
    return this.action === "swap"
      ? `No tiled window is available to swap ${this.direction}`
      : `The tiled window cannot expand ${this.direction}`;
  }
}

/** Native windowing failures retain their original cause; domain code is not wrapped. */
export class ViewNativeFailure extends Data.TaggedError("ViewNativeFailure")<{
  operation: "create" | "destroy" | "set-bounds" | "focus" | "register";
  viewId?: number;
  appId?: string;
  cause: unknown;
}> {
  get message(): string {
    const detail =
      this.cause instanceof Error ? this.cause.message : String(this.cause);
    return `Failed to ${this.operation} view${this.viewId === undefined ? "" : ` ${this.viewId}`}: ${detail}`;
  }
}

export type ViewCreateError = MainWindowUnavailable | ViewNativeFailure;
export type ViewMutationError = ViewUnavailable | ViewNativeFailure;
export type ViewModeError = ViewMutationError | ViewModeUnsupported;
export type ViewTileError = ViewMutationError | TileActionUnavailable;

/** Catch native exceptions once, for synchronous hooks and Effect workflows. */
export function callViewNative<A>(
  operation: ViewNativeFailure["operation"],
  view: { id: number; appId: string },
  call: () => A,
): Result.Result<A, ViewNativeFailure> {
  return Result.try({
    try: call,
    catch: (cause) =>
      new ViewNativeFailure({
        operation,
        viewId: view.id,
        appId: view.appId,
        cause,
      }),
  });
}

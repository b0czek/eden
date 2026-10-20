import type { ViewBounds } from "@edenapp/types";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { Event } from "../events/event";

export interface KeyboardViews {
  resolve(webContentsId: number): { appId: string; viewId: number } | undefined;
  get(
    viewId: number,
  ): { visible: boolean; bounds: ViewBounds; scale: number } | undefined;
  list(): readonly number[];
  send(viewId: number, channel: string, payload: unknown): boolean;
  setPresentationLift(lift: number): void;
  boundsChanged: Pick<Event<{ workspaceBounds: ViewBounds }>, "on">;
}
export const KeyboardViews = Context.Service<
  "eden/KeyboardViews",
  KeyboardViews
>("eden/KeyboardViews");

export interface KeyboardAssets {
  readonly frontendPath: string;
  readonly preloadPath: string;
  readonly available: Effect.Effect<boolean>;
}
export const KeyboardAssets = Context.Service<
  "eden/KeyboardAssets",
  KeyboardAssets
>("eden/KeyboardAssets");

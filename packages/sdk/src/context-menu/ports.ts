import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type { ContextMenuViewReadFailed } from "./errors";

export interface ContextMenuCaller {
  appId?: string;
  webContentsId?: number;
}

export interface ContextMenuViews {
  resolve(webContentsId: number): number | undefined;
  get(viewId: number): Effect.Effect<
    | {
        alive: boolean;
        bounds: { x: number; y: number; width: number; height: number };
        scale: number;
      }
    | undefined,
    ContextMenuViewReadFailed
  >;
  windowSize(): { width: number; height: number };
}
export const ContextMenuViews = Context.Service<
  "eden/ContextMenuViews",
  ContextMenuViews
>("eden/ContextMenuViews");

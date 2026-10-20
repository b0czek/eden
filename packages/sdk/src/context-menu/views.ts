import * as Effect from "effect/Effect";
import { asError } from "../effects/io";
import type { Views } from "../views/service";
import { ContextMenuViewReadFailed } from "./errors";
import type { ContextMenuViews } from "./ports";

export function createContextMenuViews(
  views: Pick<
    Views,
    "getViewIdByWebContentsId" | "getViewInfo" | "getWindowSize"
  >,
): ContextMenuViews {
  return {
    resolve: (webContentsId) => views.getViewIdByWebContentsId(webContentsId),
    get: (viewId) =>
      Effect.suspend(() => {
        const info = views.getViewInfo(viewId);
        if (!info) return Effect.succeed(undefined);
        return Effect.try({
          try: () => {
            const alive = !info.view.webContents.isDestroyed();
            return {
              alive,
              bounds: info.bounds,
              scale: alive ? info.view.webContents.getZoomFactor() : 1,
            };
          },
          catch: (cause) =>
            new ContextMenuViewReadFailed({
              viewId,
              message: asError(cause).message,
              cause,
            }),
        });
      }),
    windowSize: () => views.getWindowSize(),
  };
}

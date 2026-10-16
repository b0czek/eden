import type { Views } from "../views";
import type { ContextMenuViews } from "./ports";

export function createContextMenuViews(
  views: Pick<
    Views,
    "getViewIdByWebContentsId" | "getViewInfo" | "getWindowSize"
  >,
): ContextMenuViews {
  return {
    resolve: (webContentsId) => views.getViewIdByWebContentsId(webContentsId),
    get: (viewId) => {
      const info = views.getViewInfo(viewId);
      if (!info) return undefined;
      const alive = !info.view.webContents.isDestroyed();
      return {
        alive,
        bounds: info.bounds,
        scale: alive ? info.view.webContents.getZoomFactor() : 1,
      };
    },
    windowSize: () => views.getWindowSize(),
  };
}

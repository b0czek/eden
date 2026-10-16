import type { ViewManager } from "../view-manager/ViewManager";
import type { NotificationViews } from "./ports";

export function createNotificationViews(
  views: Pick<ViewManager, "getViewIdByWebContentsId" | "getViewInfo">,
): NotificationViews {
  return {
    resolve: (webContentsId) =>
      webContentsId === undefined
        ? undefined
        : views.getViewIdByWebContentsId(webContentsId),
    isAlive: (viewId) => {
      const info = views.getViewInfo(viewId);
      return !!info && !info.view.webContents.isDestroyed();
    },
  };
}

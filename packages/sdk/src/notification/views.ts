import type { Views } from "../views/service";
import type { NotificationViews } from "./ports";

export function createNotificationViews(
  views: Pick<Views, "getViewIdByWebContentsId" | "getViewInfo">,
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

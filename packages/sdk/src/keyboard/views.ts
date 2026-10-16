import type { Views } from "../views/service";
import type { KeyboardViews } from "./ports";

export function createKeyboardViews(
  views: Pick<
    Views,
    | "getAppIdByWebContentsId"
    | "getViewIdByWebContentsId"
    | "getViewInfo"
    | "getAllViews"
    | "sendToView"
    | "setKeyboardPresentationLift"
    | "globalBoundsChanged"
  >,
): KeyboardViews {
  return {
    resolve: (id) => {
      const appId = views.getAppIdByWebContentsId(id);
      const viewId = views.getViewIdByWebContentsId(id);
      return appId && viewId !== undefined ? { appId, viewId } : undefined;
    },
    get: (id) => {
      const info = views.getViewInfo(id);
      return info && !info.view.webContents.isDestroyed()
        ? {
            visible: info.visible,
            bounds: info.bounds,
            scale: info.view.webContents.getZoomFactor(),
          }
        : undefined;
    },
    list: () => [...views.getAllViews()].map(([id]) => id),
    send: (id, channel, payload) => views.sendToView(id, channel, payload),
    setPresentationLift: (lift) => views.setKeyboardPresentationLift(lift),
    boundsChanged: views.globalBoundsChanged,
  };
}

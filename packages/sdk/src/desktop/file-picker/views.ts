import * as Effect from "effect/Effect";
import type { Views } from "../views/service";
import { FilePickerIoFailed } from "./errors";
import type { FilePickerViews } from "./ports";

export function createFilePickerViews(
  views: Pick<
    Views,
    "getViewIdByWebContentsId" | "getViewInfo" | "showView" | "focusView"
  >,
): FilePickerViews {
  return {
    resolve: (id) =>
      id === undefined ? undefined : views.getViewIdByWebContentsId(id),
    get: (id) => {
      const info = views.getViewInfo(id);
      return info
        ? { alive: !info.view.webContents.isDestroyed(), bounds: info.bounds }
        : undefined;
    },
    reveal: (id) =>
      Effect.andThen(views.showView(id), views.focusView(id)).pipe(
        Effect.mapError(
          (cause) =>
            new FilePickerIoFailed({
              operation: "reveal-provider",
              viewId: id,
              message: cause instanceof Error ? cause.message : String(cause),
              cause,
            }),
        ),
      ),
  };
}

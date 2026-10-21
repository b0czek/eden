import * as Effect from "effect/Effect";
import { accessRejection } from "../filesystem/errors";
import type { Filesystem } from "../filesystem/service";
import type { Notifications } from "../notification/service";
import type { Processes } from "../processes/service";
import type { Views } from "../views/service";
import { FilePickerIoFailed } from "./errors";
import type {
  FilePickerFiles,
  FilePickerNotifications,
  FilePickerProcesses,
  FilePickerViews,
} from "./ports";

export function createFilePickerProcesses(
  processes: Pick<
    Processes,
    "ensureAppRunning" | "getAppInstance" | "stopApp" | "stopped"
  >,
): FilePickerProcesses {
  return {
    ensureRunning: (appId) =>
      Effect.asVoid(processes.ensureAppRunning(appId)).pipe(
        Effect.mapError(
          (cause) =>
            new FilePickerIoFailed({
              operation: "start-provider",
              appId,
              message: cause.message,
              cause,
            }),
        ),
      ),
    isRunning: (appId) => Boolean(processes.getAppInstance(appId)),
    stop: (appId) =>
      processes.stopApp(appId).pipe(
        Effect.mapError(
          (cause) =>
            new FilePickerIoFailed({
              operation: "stop-provider",
              appId,
              message: cause.message,
              cause,
            }),
        ),
      ),
    stopped: processes.stopped,
  };
}

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

export function createFilePickerFiles(
  files: Pick<Filesystem, "resolvePath" | "accessScope">,
): FilePickerFiles {
  return {
    resolvePath: (location) => Effect.asVoid(files.resolvePath(location)),
    accessScope: (volume) =>
      Effect.try({
        try: () => files.accessScope(volume),
        catch: accessRejection,
      }),
  };
}

/** Compose native notification callbacks with the picker replacement Effect. */
export function createFilePickerNotifications(
  notifications: Pick<Notifications, "pushNotification">,
): FilePickerNotifications {
  return {
    busy: (replace) =>
      Effect.asVoid(
        notifications.pushNotification(
          "File picker is busy",
          "Resolve the current file picker before opening another.",
          0,
          "warning",
          [{ id: "force-open-file-picker", label: "Force open" }],
          {
            "force-open-file-picker": () => Effect.asVoid(replace),
          },
        ),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new FilePickerIoFailed({
              operation: "notify-busy",
              message: cause.message,
              cause,
            }),
        ),
      ),
  };
}

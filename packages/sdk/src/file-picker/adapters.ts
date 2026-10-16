import * as Effect from "effect/Effect";
import type { FilesystemManager } from "../filesystem/FilesystemManager";
import type { Notifications } from "../notification/service";
import type { ProcessManager } from "../process-manager/ProcessManager";
import type { ViewManager } from "../view-manager/ViewManager";
import type {
  FilePickerFiles,
  FilePickerNotifications,
  FilePickerProcesses,
  FilePickerViews,
} from "./ports";

const asError = (error: unknown) =>
  error instanceof Error ? error : new Error(String(error));

export function createFilePickerProcesses(
  processes: Pick<
    ProcessManager,
    "ensureAppRunning" | "getAppInstance" | "stopApp" | "stopped"
  >,
): FilePickerProcesses {
  return {
    ensureRunning: (appId) => Effect.asVoid(processes.ensureAppRunning(appId)),
    isRunning: (appId) => Boolean(processes.getAppInstance(appId)),
    stop: (appId) => processes.stopApp(appId),
    stopped: processes.stopped,
  };
}

export function createFilePickerViews(
  views: Pick<
    ViewManager,
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
      Effect.try({
        try: () => {
          views.showView(id);
          views.focusView(id);
        },
        catch: asError,
      }),
  };
}

export function createFilePickerFiles(
  files: Pick<FilesystemManager, "resolvePath" | "accessScope">,
): FilePickerFiles {
  return {
    resolvePath: (location) => Effect.asVoid(files.resolvePath(location)),
    accessScope: (volume) => files.accessScope(volume),
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
      ),
  };
}

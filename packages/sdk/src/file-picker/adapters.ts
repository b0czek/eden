import * as Effect from "effect/Effect";
import type { EventListener } from "../events/event";
import type { FilesystemManager } from "../filesystem/FilesystemManager";
import type { NotificationManager } from "../notification/NotificationManager";
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
    "ensureAppRunning" | "getAppInstance" | "stopApp"
  > & {
    on(
      event: "stopped",
      listener: EventListener<{ appId: string }>,
    ): () => void;
  },
): FilePickerProcesses {
  return {
    ensureRunning: (appId) =>
      Effect.tryPromise({
        try: async () => {
          await processes.ensureAppRunning(appId);
        },
        catch: asError,
      }).pipe(Effect.uninterruptible),
    isRunning: (appId) => Boolean(processes.getAppInstance(appId)),
    stop: (appId) =>
      Effect.tryPromise({
        try: () => processes.stopApp(appId),
        catch: asError,
      }).pipe(Effect.uninterruptible),
    stopped: { on: (listener) => processes.on("stopped", listener) },
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
    resolvePath: (location) =>
      Effect.tryPromise({
        try: async () => {
          await files.resolvePath(location);
        },
        catch: asError,
      }),
    accessScope: (volume) => files.accessScope(volume),
  };
}

/** The notification callback is a host boundary and uses its owning runtime. */
export function createFilePickerNotifications(
  notifications: Pick<NotificationManager, "pushNotification">,
  run: <A>(effect: Effect.Effect<A, Error>) => Promise<A>,
): FilePickerNotifications {
  return {
    busy: (replace) => {
      notifications.pushNotification(
        "File picker is busy",
        "Resolve the current file picker before opening another.",
        0,
        "warning",
        [{ id: "force-open-file-picker", label: "Force open" }],
        {
          "force-open-file-picker": async () => {
            await run(replace);
          },
        },
      );
    },
  };
}

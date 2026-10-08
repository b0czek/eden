import { createOperation } from "@edenapp/solid-kit";
import type { DialogController } from "@edenapp/solid-kit/dialogs";
import { createRoot, createSignal, onCleanup } from "solid-js";
import { t } from "../i18n";
import type { AppInfo } from "../types";

type AppActivity = NonNullable<AppInfo["activity"]>;

export function useAppOperations(options: {
  dialogs: DialogController;
  refresh: () => Promise<void>;
}) {
  const [activities, setActivities] = createSignal<
    Partial<Record<string, AppActivity>>
  >({});
  const [errorDialogs, setErrorDialogs] = createSignal(0);
  const observers = new Set<() => void>();
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    for (const dispose of observers) dispose();
    observers.clear();
  });

  const activity = (appId: string) => activities()[appId];

  const run = async (appId: string, action: AppActivity) => {
    if (disposed || activity(appId)) return;
    setActivities((current) => ({ ...current, [appId]: action }));
    // Each app can run independently; its observer lives until completion or
    // shell disposal, rather than being owned by an async event handler.
    const observer = createRoot((dispose) => ({
      operation: createOperation(),
      dispose,
    }));
    observers.add(observer.dispose);

    try {
      const result = await observer.operation.run(() =>
        action === "launch"
          ? window.edenAPI.shellCommand("process/launch", { appId })
          : window.edenAPI.shellCommand("process/stop", { appId }),
      );
      if (!result.success) {
        throw new Error(
          "error" in result && typeof result.error === "string"
            ? result.error
            : t("shell.appOperationFailed"),
        );
      }
      if (!disposed) await options.refresh();
    } catch (error) {
      if (disposed) return;
      setErrorDialogs((count) => count + 1);
      try {
        await options.dialogs.alert({
          title: t("common.error"),
          message:
            error instanceof Error
              ? error.message
              : t("shell.appOperationFailed"),
          okLabel: t("common.ok"),
        });
      } finally {
        setErrorDialogs((count) => count - 1);
      }
    } finally {
      observer.dispose();
      observers.delete(observer.dispose);
      setActivities((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
    }
  };

  return {
    activity,
    hasErrorDialog: () => errorDialogs() > 0,
    launch: (appId: string) => run(appId, "launch"),
    stop: (appId: string) => run(appId, "stop"),
  };
}

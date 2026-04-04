import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import { initLocale, t } from "../i18n";
import { getAppGroupKey, getChildProcesses, normalizeSnapshot } from "./model";
import {
  EMPTY_SNAPSHOT,
  type AppIcons,
  type ExpandedGroups,
  type ProcessMetricsState,
  type TrackedAppProcessMetrics,
} from "./types";

const POLL_INTERVAL_MS = 1000;
const POLLING_TIMEOUT_MS = 2600;

export const useProcessMetrics = () => {
  const [snapshot, setSnapshot] =
    createStore<ProcessMetricsState>(EMPTY_SNAPSHOT);
  const [refreshing, setRefreshing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [expandedGroups, setExpandedGroups] = createSignal<ExpandedGroups>({});
  const [appIcons, setAppIcons] = createSignal<AppIcons>({});

  const syncExpandedGroups = (apps: TrackedAppProcessMetrics[]) => {
    setExpandedGroups((current) => {
      let changed = false;
      const next: ExpandedGroups = {};
      for (const app of apps) {
        const appId = getAppGroupKey(app);
        const hasChildren = getChildProcesses(app).length > 1;
        if (!hasChildren) continue;
        const nextValue = current[appId] ?? true;
        next[appId] = nextValue;
        if (!(appId in current) || current[appId] !== nextValue) {
          changed = true;
        }
      }

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  };

  const refreshMetrics = async () => {
    if (refreshing()) return;

    setRefreshing(true);

    try {
      const nextSnapshot = normalizeSnapshot(
        await window.edenAPI.shellCommand("process/metrics", {
          showHidden: true,
          pollingTimeoutMs: POLLING_TIMEOUT_MS,
          waitForAccurateCpu: false,
        }),
      );
      setSnapshot(reconcile(nextSnapshot, { merge: true }));
      syncExpandedGroups(nextSnapshot.apps);
      setError(null);
    } catch (caughtError) {
      console.error("Failed to load process metrics:", caughtError);
      setError(t("taskManager.labels.sampleFailed"));
    } finally {
      setRefreshing(false);
    }
  };

  onMount(() => {
    const intervalId = window.setInterval(() => {
      void refreshMetrics();
    }, POLL_INTERVAL_MS);

    void (async () => {
      await initLocale();
      await refreshMetrics();
    })();

    onCleanup(() => {
      window.clearInterval(intervalId);
    });
  });

  createEffect(() => {
    const apps = snapshot.apps;
    const currentIcons = appIcons();
    const missingAppIds = [
      ...new Set(apps.map((app) => app.instance.manifest.id)),
    ].filter((appId) => !(appId in currentIcons));

    if (missingAppIds.length === 0) return;

    void Promise.all(
      missingAppIds.map(async (appId) => {
        try {
          const result = await window.edenAPI.shellCommand("package/get-icon", {
            appId,
          });
          return [appId, result.icon] as const;
        } catch (caughtError) {
          console.warn(`Failed to load icon for ${appId}:`, caughtError);
          return [appId, undefined] as const;
        }
      }),
    ).then((entries) => {
      setAppIcons((existing) => {
        const next = { ...existing };
        let changed = false;
        for (const [appId, icon] of entries) {
          if (next[appId] === icon && appId in next) continue;
          next[appId] = icon;
          changed = true;
        }
        return changed ? next : existing;
      });
    });
  });

  const toggleAppGroup = (appId: string) => {
    setExpandedGroups((current) => ({
      ...current,
      [appId]: !current[appId],
    }));
  };

  return {
    appIcons,
    error,
    expandedGroups,
    refreshMetrics,
    snapshot,
    toggleAppGroup,
  };
};

import type {
  AppProcessMetrics,
  EdenProcessMetric,
  ProcessMetricsSnapshot,
} from "@edenapp/types";

export type ExpandedGroups = Record<string, boolean>;
export type AppIcons = Record<string, string | undefined>;
export type TrackedProcessMetric = EdenProcessMetric & { id: string };
export type TrackedAppProcessMetrics = AppProcessMetrics & {
  id: string;
  renderer?: TrackedProcessMetric;
  backend?: TrackedProcessMetric;
};
export type ProcessMetricsState = Omit<
  ProcessMetricsSnapshot,
  "apps" | "sharedProcesses"
> & {
  apps: TrackedAppProcessMetrics[];
  sharedProcesses: TrackedProcessMetric[];
};

export const EMPTY_SNAPSHOT: ProcessMetricsState = {
  sampledAt: "",
  apps: [],
  sharedProcesses: [],
  totals: {
    appCPUPercent: 0,
    sharedCPUPercent: 0,
    overallCPUPercent: 0,
    appMemoryWorkingSetSize: 0,
    sharedMemoryWorkingSetSize: 0,
    overallMemoryWorkingSetSize: 0,
  },
};

/**
 * CPU usage sample for a tracked Eden process.
 */
export interface EdenProcessCpuUsage {
  /** CPU usage percentage since the previous sample. */
  percentCPUUsage: number;

  /** Total CPU time in seconds since process startup, when available. */
  cumulativeCPUUsage?: number;

  /** Average idle wakeups per second since the previous sample. */
  idleWakeupsPerSecond: number;
}

/**
 * Memory usage sample for a tracked Eden process.
 *
 * All values are reported in kilobytes.
 */
export interface EdenProcessMemoryUsage {
  /** Memory currently pinned to physical RAM. */
  workingSetSize: number;

  /** Peak working set size. */
  peakWorkingSetSize: number;

  /** Memory private to the process, when available. */
  privateBytes?: number;
}

/**
 * A single Electron process attributed to an Eden app or to shared/system work.
 */
export interface EdenProcessMetric {
  /** OS process id. */
  pid: number;

  /** Creation time in milliseconds since the Unix epoch. */
  creationTime: number;

  /** Eden-level grouping used by the task manager. */
  category: "renderer" | "backend" | "shared";

  /** Electron/Chromium process type, e.g. "Tab", "Utility", "GPU". */
  processType: string;

  /** Electron utility service name, when available. */
  serviceName?: string;

  /** Human-readable process name, when available. */
  name?: string;

  /** Eden app id if this process belongs to an app. */
  appId?: string;

  /** Eden view id for renderer processes. */
  viewId?: number;

  /** CPU usage snapshot. */
  cpu: EdenProcessCpuUsage;

  /** Memory usage snapshot. */
  memory: EdenProcessMemoryUsage;
}

/**
 * Aggregated resource usage for a running Eden app instance.
 */
export interface AppProcessMetrics {
  /** Running app instance metadata. */
  instance: import("./index").AppInstance;

  /** Sum of CPU usage across app-owned processes. */
  totalCPUPercent: number;

  /** Sum of working set memory across app-owned processes, in KB. */
  totalMemoryWorkingSetSize: number;

  /** Sum of peak working set memory across app-owned processes, in KB. */
  totalMemoryPeakWorkingSetSize: number;

  /** Renderer process metrics, when the app has a frontend. */
  renderer?: EdenProcessMetric;

  /** Backend utility process metrics, when the app has a backend. */
  backend?: EdenProcessMetric;
}

/**
 * Aggregate totals for a process metrics snapshot.
 */
export interface ProcessMetricsTotals {
  /** CPU used by tracked Eden app processes. */
  appCPUPercent: number;

  /** CPU used by unattributed Electron processes. */
  sharedCPUPercent: number;

  /** Total CPU usage across all Electron app metrics. */
  overallCPUPercent: number;

  /** Working set memory used by tracked Eden app processes, in KB. */
  appMemoryWorkingSetSize: number;

  /** Working set memory used by unattributed Electron processes, in KB. */
  sharedMemoryWorkingSetSize: number;

  /** Total working set memory across all Electron app metrics, in KB. */
  overallMemoryWorkingSetSize: number;
}

/**
 * Full snapshot used by the Eden task manager/profiler.
 */
export interface ProcessMetricsSnapshot {
  /** ISO timestamp describing when the sample was created. */
  sampledAt: string;

  /** Per-app resource usage. */
  apps: AppProcessMetrics[];

  /** Electron processes that cannot be safely attributed to a single Eden app. */
  sharedProcesses: EdenProcessMetric[];

  /** Aggregate totals for the sample. */
  totals: ProcessMetricsTotals;
}

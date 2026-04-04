import type {
  AppInstance,
  AppProcessMetrics,
  EdenProcessMetric,
  ProcessMetricsSnapshot,
} from "@edenapp/types";
import { app, type ProcessMetric as ElectronProcessMetric } from "electron";
import type { ViewManager } from "../view-manager/ViewManager";
import type { BackendManager } from "./BackendManager";

interface MetricsRequest {
  showHidden: boolean;
  resolve: (snapshot: ProcessMetricsSnapshot) => void;
  reject: (error: Error) => void;
}

interface CachedMetricsSample {
  sampledAt: string;
  appMetrics: ElectronProcessMetric[];
}

const METRICS_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_METRICS_POLLING_TIMEOUT_MS = 1000;
const MAX_METRICS_POLLING_TIMEOUT_MS = 10000;

interface ProcessMetricsCollectorDeps {
  backendManager: BackendManager;
  viewManager: ViewManager;
  getRunningApps: (showHidden?: boolean) => AppInstance[];
}

export class ProcessMetricsCollector {
  private readonly backendManager: BackendManager;
  private readonly viewManager: ViewManager;
  private readonly getRunningApps: (showHidden?: boolean) => AppInstance[];
  private metricsSampler: NodeJS.Timeout | null = null;
  private nextMetricsRequestId = 0;
  private pendingMetricsRequests: Map<number, MetricsRequest> = new Map();
  private metricsSamplerKeepAliveUntil = 0;
  private latestMetricsSample: CachedMetricsSample | null = null;

  constructor(deps: ProcessMetricsCollectorDeps) {
    this.backendManager = deps.backendManager;
    this.viewManager = deps.viewManager;
    this.getRunningApps = deps.getRunningApps;
  }

  async getMetrics(
    showHidden: boolean = false,
    pollingTimeoutMs: number = DEFAULT_METRICS_POLLING_TIMEOUT_MS,
    waitForAccurateCpu: boolean = true,
  ): Promise<ProcessMetricsSnapshot> {
    const normalizedTimeout = Math.max(
      METRICS_SAMPLE_INTERVAL_MS,
      Math.min(MAX_METRICS_POLLING_TIMEOUT_MS, pollingTimeoutMs),
    );
    this.extendMetricsSamplerKeepAlive(normalizedTimeout);
    this.ensureMetricsSampler(waitForAccurateCpu);

    if (this.latestMetricsSample) {
      return this.buildMetricsSnapshot(
        this.latestMetricsSample.appMetrics,
        this.latestMetricsSample.sampledAt,
        showHidden,
      );
    }

    if (!waitForAccurateCpu) {
      const immediateSample = this.captureMetricsSample();
      return this.buildMetricsSnapshot(
        immediateSample.appMetrics,
        immediateSample.sampledAt,
        showHidden,
      );
    }

    return await new Promise<ProcessMetricsSnapshot>((resolve, reject) => {
      this.pendingMetricsRequests.set(this.nextMetricsRequestId++, {
        showHidden,
        resolve,
        reject,
      });
    });
  }

  private ensureMetricsSampler(waitForAccurateCpu: boolean): void {
    if (this.metricsSampler) return;

    if (waitForAccurateCpu) {
      // Prime Electron's CPU sampler so the next interval-based sample is useful.
      app.getAppMetrics();
      this.latestMetricsSample = null;
    } else {
      this.captureMetricsSample();
    }

    this.metricsSampler = setInterval(() => {
      this.collectMetricsSample();
    }, METRICS_SAMPLE_INTERVAL_MS);
  }

  private extendMetricsSamplerKeepAlive(timeoutMs: number): void {
    this.metricsSamplerKeepAliveUntil = Math.max(
      this.metricsSamplerKeepAliveUntil,
      Date.now() + timeoutMs,
    );
  }

  private collectMetricsSample(): void {
    if (
      this.pendingMetricsRequests.size === 0 &&
      Date.now() >= this.metricsSamplerKeepAliveUntil
    ) {
      this.stopMetricsSampler();
      return;
    }

    try {
      const { appMetrics, sampledAt } = this.captureMetricsSample();

      for (const [
        requestId,
        request,
      ] of this.pendingMetricsRequests.entries()) {
        request.resolve(
          this.buildMetricsSnapshot(appMetrics, sampledAt, request.showHidden),
        );
        this.pendingMetricsRequests.delete(requestId);
      }
    } catch (error) {
      const failure =
        error instanceof Error
          ? error
          : new Error(`Failed to collect process metrics: ${String(error)}`);

      for (const [, request] of this.pendingMetricsRequests.entries()) {
        request.reject(failure);
      }
      this.pendingMetricsRequests.clear();
      this.stopMetricsSampler();
    }
  }

  private captureMetricsSample(): CachedMetricsSample {
    const appMetrics = app.getAppMetrics();
    const sampledAt = new Date().toISOString();
    const sample = { sampledAt, appMetrics };
    this.latestMetricsSample = sample;
    return sample;
  }

  private stopMetricsSampler(): void {
    if (!this.metricsSampler) return;
    clearInterval(this.metricsSampler);
    this.metricsSampler = null;
    this.metricsSamplerKeepAliveUntil = 0;
    this.latestMetricsSample = null;
  }

  private buildMetricsSnapshot(
    appMetrics: ElectronProcessMetric[],
    sampledAt: string,
    showHidden: boolean,
  ): ProcessMetricsSnapshot {
    const metricsByPid = new Map(
      appMetrics.map((metric) => [metric.pid, metric] as const),
    );
    const matchedPids = new Set<number>();
    const visibleAppIds = new Set(
      this.getRunningApps(showHidden).map((instance) => instance.manifest.id),
    );

    const apps = this.getRunningApps(true)
      .map((instance) => {
        const rendererMetric = this.resolveRendererMetric(
          instance,
          metricsByPid,
        );
        const backendMetric = this.resolveBackendMetric(instance, metricsByPid);

        if (rendererMetric) matchedPids.add(rendererMetric.pid);
        if (backendMetric) matchedPids.add(backendMetric.pid);

        const totalCPUPercent =
          (rendererMetric?.cpu.percentCPUUsage ?? 0) +
          (backendMetric?.cpu.percentCPUUsage ?? 0);
        const totalMemoryWorkingSetSize =
          (rendererMetric?.memory.workingSetSize ?? 0) +
          (backendMetric?.memory.workingSetSize ?? 0);
        const totalMemoryPeakWorkingSetSize =
          (rendererMetric?.memory.peakWorkingSetSize ?? 0) +
          (backendMetric?.memory.peakWorkingSetSize ?? 0);

        const snapshot: AppProcessMetrics = {
          instance,
          totalCPUPercent,
          totalMemoryWorkingSetSize,
          totalMemoryPeakWorkingSetSize,
        };

        if (rendererMetric) snapshot.renderer = rendererMetric;
        if (backendMetric) snapshot.backend = backendMetric;

        return snapshot;
      })
      .filter((snapshot) => visibleAppIds.has(snapshot.instance.manifest.id))
      .sort((left, right) => {
        if (right.totalCPUPercent !== left.totalCPUPercent) {
          return right.totalCPUPercent - left.totalCPUPercent;
        }
        return right.totalMemoryWorkingSetSize - left.totalMemoryWorkingSetSize;
      });

    const sharedProcesses = appMetrics
      .filter((metric) => !matchedPids.has(metric.pid))
      .map((metric) => this.toProcessMetric(metric, "shared"))
      .sort((left, right) => {
        if (right.cpu.percentCPUUsage !== left.cpu.percentCPUUsage) {
          return right.cpu.percentCPUUsage - left.cpu.percentCPUUsage;
        }
        return right.memory.workingSetSize - left.memory.workingSetSize;
      });

    const appCPUPercent = apps.reduce(
      (sum, entry) => sum + entry.totalCPUPercent,
      0,
    );
    const appMemoryWorkingSetSize = apps.reduce(
      (sum, entry) => sum + entry.totalMemoryWorkingSetSize,
      0,
    );
    const sharedCPUPercent = sharedProcesses.reduce(
      (sum, entry) => sum + entry.cpu.percentCPUUsage,
      0,
    );
    const sharedMemoryWorkingSetSize = sharedProcesses.reduce(
      (sum, entry) => sum + entry.memory.workingSetSize,
      0,
    );

    return {
      sampledAt,
      apps,
      sharedProcesses,
      totals: {
        appCPUPercent,
        sharedCPUPercent,
        overallCPUPercent: appCPUPercent + sharedCPUPercent,
        appMemoryWorkingSetSize,
        sharedMemoryWorkingSetSize,
        overallMemoryWorkingSetSize:
          appMemoryWorkingSetSize + sharedMemoryWorkingSetSize,
      },
    };
  }

  private resolveRendererMetric(
    instance: AppInstance,
    metricsByPid: Map<number, ElectronProcessMetric>,
  ): EdenProcessMetric | undefined {
    if (instance.viewId === -1) return undefined;

    const view = this.viewManager.getView(instance.viewId);
    if (!view || view.webContents.isDestroyed()) return undefined;

    const rendererPid = view.webContents.getOSProcessId();
    if (!rendererPid || rendererPid <= 0) return undefined;

    const metric = metricsByPid.get(rendererPid);
    if (!metric) return undefined;

    return this.toProcessMetric(metric, "renderer", {
      appId: instance.manifest.id,
      viewId: instance.viewId,
    });
  }

  private resolveBackendMetric(
    instance: AppInstance,
    metricsByPid: Map<number, ElectronProcessMetric>,
  ): EdenProcessMetric | undefined {
    const backendPid = this.backendManager.getBackend(
      instance.manifest.id,
    )?.pid;
    if (!backendPid || backendPid <= 0) return undefined;

    const metric = metricsByPid.get(backendPid);
    if (!metric) return undefined;

    return this.toProcessMetric(metric, "backend", {
      appId: instance.manifest.id,
    });
  }

  private toProcessMetric(
    metric: ElectronProcessMetric,
    category: EdenProcessMetric["category"],
    options: { appId?: string; viewId?: number } = {},
  ): EdenProcessMetric {
    const snapshot: EdenProcessMetric = {
      pid: metric.pid,
      creationTime: metric.creationTime,
      category,
      processType: metric.type,
      cpu: {
        percentCPUUsage: metric.cpu.percentCPUUsage,
        cumulativeCPUUsage: metric.cpu.cumulativeCPUUsage,
        idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond,
      },
      memory: {
        workingSetSize: metric.memory.workingSetSize,
        peakWorkingSetSize: metric.memory.peakWorkingSetSize,
        privateBytes: metric.memory.privateBytes,
      },
    };

    if (metric.serviceName) snapshot.serviceName = metric.serviceName;
    if (metric.name) snapshot.name = metric.name;
    if (options.appId) snapshot.appId = options.appId;
    if (options.viewId !== undefined) snapshot.viewId = options.viewId;

    return snapshot;
  }
}

import type {
  AppInstance,
  AppProcessMetrics,
  EdenProcessMetric,
  ProcessMetricsSnapshot,
} from "@edenapp/types";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Option from "effect/Option";
import type {
  PlatformProcessMetric,
  ProcessMetricsPort,
} from "../platform/ports";
import type { Views } from "../views/service";
import type { Backends } from "./backends";

import {
  type ProcessMetricsError,
  ProcessMetricsFailed,
  ProcessMetricsStopped,
} from "./errors";

interface CachedMetricsSample {
  sampledAt: string;
  appMetrics: PlatformProcessMetric[];
}

const createPendingSample = () => ({
  result: Deferred.makeUnsafe<CachedMetricsSample, ProcessMetricsError>(),
  readers: 0,
});

const metricsFailure = (cause: unknown) =>
  new ProcessMetricsFailed({
    cause,
    message:
      cause instanceof Error
        ? cause.message
        : `Failed to collect process metrics: ${String(cause)}`,
  });

const METRICS_SAMPLE_INTERVAL_MS = 1000;
const DEFAULT_METRICS_POLLING_TIMEOUT_MS = 1000;
const MAX_METRICS_POLLING_TIMEOUT_MS = 10000;

interface ProcessMetricsDeps {
  backends: Pick<Backends, "getBackend">;
  views: Pick<Views, "getView">;
  getRunningApps: (showHidden?: boolean) => AppInstance[];
  processMetrics: ProcessMetricsPort;
}
export const createProcessMetrics = Effect.fn(function* ({
  backends,
  views,
  getRunningApps,
  processMetrics,
}: ProcessMetricsDeps) {
  const clock = yield* Clock.Clock;
  const sampler = yield* FiberHandle.make<void>();
  let firstSample = createPendingSample();
  let _metricsSamplerKeepAliveUntil = 0;
  let _latestMetricsSample: CachedMetricsSample | null = null;

  const getMetrics = Effect.fn(function* (
    showHidden: boolean = false,
    pollingTimeoutMs: number = DEFAULT_METRICS_POLLING_TIMEOUT_MS,
    waitForAccurateCpu: boolean = true,
  ) {
    const normalizedTimeout = Math.max(
      METRICS_SAMPLE_INTERVAL_MS,
      Math.min(MAX_METRICS_POLLING_TIMEOUT_MS, pollingTimeoutMs),
    );
    extendMetricsSamplerKeepAlive(normalizedTimeout);
    yield* ensureMetricsSampler(waitForAccurateCpu);

    if (_latestMetricsSample) {
      return buildMetricsSnapshot(
        _latestMetricsSample.appMetrics,
        _latestMetricsSample.sampledAt,
        showHidden,
      );
    }

    if (!waitForAccurateCpu) {
      const immediateSample = yield* Effect.try({
        try: captureMetricsSample,
        catch: metricsFailure,
      });
      return buildMetricsSnapshot(
        immediateSample.appMetrics,
        immediateSample.sampledAt,
        showHidden,
      );
    }

    const waiting = firstSample;
    waiting.readers++;
    const sample = yield* Deferred.await(waiting.result).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          waiting.readers--;
        }),
      ),
    );
    return buildMetricsSnapshot(
      sample.appMetrics,
      sample.sampledAt,
      showHidden,
    );
  });

  const ensureMetricsSampler = Effect.fn(function* (
    waitForAccurateCpu: boolean,
  ) {
    if (Option.isSome(yield* FiberHandle.get(sampler))) return;

    firstSample = createPendingSample();
    yield* Effect.try({
      try: () => {
        if (waitForAccurateCpu) {
          // Prime Electron's CPU sampler so the next interval-based sample is useful.
          processMetrics.getAppMetrics();
          _latestMetricsSample = null;
        } else {
          captureMetricsSample();
        }
      },
      catch: metricsFailure,
    });
    const waiting = firstSample;
    yield* FiberHandle.run(
      sampler,
      Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(Duration.millis(METRICS_SAMPLE_INTERVAL_MS));
          if (
            (waiting.readers === 0 || Deferred.isDoneUnsafe(waiting.result)) &&
            clock.currentTimeMillisUnsafe() >= _metricsSamplerKeepAliveUntil
          )
            return;
          const sample = yield* Effect.try({
            try: captureMetricsSample,
            catch: metricsFailure,
          });
          yield* Deferred.succeed(waiting.result, sample);
        }
      }).pipe(
        Effect.catch((error) =>
          Effect.asVoid(Deferred.fail(waiting.result, error)),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            _metricsSamplerKeepAliveUntil = 0;
            _latestMetricsSample = null;
          }),
        ),
      ),
    );
  });

  function extendMetricsSamplerKeepAlive(timeoutMs: number): void {
    _metricsSamplerKeepAliveUntil = Math.max(
      _metricsSamplerKeepAliveUntil,
      clock.currentTimeMillisUnsafe() + timeoutMs,
    );
  }

  function captureMetricsSample(): CachedMetricsSample {
    const appMetrics = processMetrics.getAppMetrics();
    const sampledAt = new Date(clock.currentTimeMillisUnsafe()).toISOString();
    const sample = { sampledAt, appMetrics };
    _latestMetricsSample = sample;
    return sample;
  }

  function buildMetricsSnapshot(
    appMetrics: PlatformProcessMetric[],
    sampledAt: string,
    showHidden: boolean,
  ): ProcessMetricsSnapshot {
    const metricsByPid = new Map(
      appMetrics.map((metric) => [metric.pid, metric] as const),
    );
    const matchedPids = new Set<number>();
    const visibleAppIds = new Set(
      getRunningApps(showHidden).map((instance) => instance.manifest.id),
    );

    const apps = getRunningApps(true)
      .map((instance) => {
        const rendererMetric = resolveRendererMetric(instance, metricsByPid);
        const backendMetric = resolveBackendMetric(instance, metricsByPid);

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
        const leftName = String(
          left.instance.manifest.name || left.instance.manifest.id,
        );
        const rightName = String(
          right.instance.manifest.name || right.instance.manifest.id,
        );
        return leftName.localeCompare(rightName);
      });

    const sharedProcesses = appMetrics
      .filter((metric) => !matchedPids.has(metric.pid))
      .map((metric) => toProcessMetric(metric, "shared"))
      .sort((left, right) => {
        const leftName = String(
          left.name || left.serviceName || left.processType || left.pid,
        );
        const rightName = String(
          right.name || right.serviceName || right.processType || right.pid,
        );
        return leftName.localeCompare(rightName);
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

  function resolveRendererMetric(
    instance: AppInstance,
    metricsByPid: Map<number, PlatformProcessMetric>,
  ): EdenProcessMetric | undefined {
    if (instance.viewId === -1) return undefined;

    const view = views.getView(instance.viewId);
    if (!view || view.webContents.isDestroyed()) return undefined;

    const rendererPid = view.webContents.getOSProcessId();
    if (!rendererPid || rendererPid <= 0) return undefined;

    const metric = metricsByPid.get(rendererPid);
    if (!metric) return undefined;

    return toProcessMetric(metric, "renderer", {
      appId: instance.manifest.id,
      viewId: instance.viewId,
    });
  }

  function resolveBackendMetric(
    instance: AppInstance,
    metricsByPid: Map<number, PlatformProcessMetric>,
  ): EdenProcessMetric | undefined {
    const backendPid = backends.getBackend(instance.manifest.id)?.pid;
    if (!backendPid || backendPid <= 0) return undefined;

    const metric = metricsByPid.get(backendPid);
    if (!metric) return undefined;

    return toProcessMetric(metric, "backend", {
      appId: instance.manifest.id,
    });
  }

  function toProcessMetric(
    metric: PlatformProcessMetric,
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
        idleWakeupsPerSecond: metric.cpu.idleWakeupsPerSecond ?? 0,
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

  function dispose(): void {
    Deferred.doneUnsafe(
      firstSample.result,
      Effect.fail(
        new ProcessMetricsStopped({ message: "Eden runtime disposed" }),
      ),
    );
  }
  yield* Effect.addFinalizer(() => Effect.sync(dispose));
  return { getMetrics };
});

export type ProcessMetrics = Effect.Success<
  ReturnType<typeof createProcessMetrics>
>;

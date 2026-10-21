import type { AppInstance, AppManifest } from "@edenapp/types";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
import type {
  PlatformUtilityProcess,
  PlatformView,
} from "../platform/ports/types";
import { createProcessMetrics } from "./metrics";

const getAppMetrics = jest.fn();

type MetricsDependencies = Parameters<typeof createProcessMetrics>[0];
type BackendsLike = Pick<MetricsDependencies["backends"], "getBackend">;
type ViewsLike = Pick<MetricsDependencies["views"], "getView">;

const createMockBackend = (pid: number): PlatformUtilityProcess =>
  ({ pid }) as PlatformUtilityProcess;

const createMockView = (pid: number): PlatformView =>
  ({
    webContents: {
      isDestroyed: () => false,
      getOSProcessId: () => pid,
    },
  }) as PlatformView;

const createApp = (
  appId: string,
  viewId: number,
  overrides: Partial<AppInstance> = {},
): AppInstance =>
  ({
    manifest: {
      id: appId,
      name: appId,
      version: "1.0.0",
      frontend: { entry: "dist/index.html" },
      permissions: [],
    },
    instanceId: `${appId}-instance`,
    installPath: `/apps/${appId}`,
    viewId,
    state: "running",
    installedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastLaunched: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  }) as AppInstance;

const metric = (
  pid: number,
  cpuPercent: number,
  workingSetSize: number,
  peakWorkingSetSize: number,
  extra: Record<string, unknown> = {},
) => ({
  pid,
  creationTime: pid,
  type: "Tab",
  cpu: {
    percentCPUUsage: cpuPercent,
    cumulativeCPUUsage: cpuPercent * 10,
    idleWakeupsPerSecond: 0,
  },
  memory: {
    workingSetSize,
    peakWorkingSetSize,
  },
  ...extra,
});

const runtimes: ReturnType<typeof createEffectRuntime>[] = [];

const createMetricsFixture = async (deps: {
  backends: BackendsLike;
  views: ViewsLike;
  getRunningApps: MetricsDependencies["getRunningApps"];
}) => {
  const runtime = createEffectRuntime(TestClock.layer());
  runtimes.push(runtime);
  const metrics = await runtime.acquire(
    createProcessMetrics({
      backends: deps.backends as MetricsDependencies["backends"],
      views: deps.views as MetricsDependencies["views"],
      getRunningApps: deps.getRunningApps,
      processMetrics: { getAppMetrics },
    }),
  );
  return {
    ...metrics,
    forkMetrics: (...args: Parameters<typeof metrics.getMetrics>) =>
      runtime.fork(metrics.getMetrics(...args)),
    advance: (milliseconds: number) =>
      runtime.run(TestClock.adjust(Duration.millis(milliseconds))),
    getMetrics: (...args: Parameters<typeof metrics.getMetrics>) =>
      runtime.run(metrics.getMetrics(...args)),
  };
};

describe("ProcessMetrics", () => {
  beforeEach(() => {
    getAppMetrics.mockReset();
  });

  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  });

  it("uses a fixed main-process sampling cadence and lets callers extend sampler keepalive", async () => {
    const visibleApp = createApp("com.eden.visible", 10, {
      manifest: {
        id: "com.eden.visible",
        name: "Zulu",
        version: "1.0.0",
        frontend: { entry: "dist/index.html" },
        permissions: [],
      } as AppManifest,
    });
    const hiddenApp = createApp("com.eden.hidden", 20, {
      manifest: {
        id: "com.eden.hidden",
        name: "Alpha",
        version: "1.0.0",
        frontend: { entry: "dist/index.html" },
        overlay: true,
        permissions: [],
      } as AppManifest,
    });

    const apps = [visibleApp, hiddenApp];
    const getView = jest.fn((viewId: number) => {
      const pidByViewId: Record<number, number> = { 10: 111, 20: 222 };
      const pid = pidByViewId[viewId];
      if (!pid) return undefined;
      return createMockView(pid);
    });
    const getBackend = jest.fn((appId: string) =>
      appId === "com.eden.visible" ? createMockBackend(333) : undefined,
    );

    const metrics = await createMetricsFixture({
      backends: {
        getBackend,
      },
      views: {
        getView,
      },
      getRunningApps: (showHidden = false) =>
        showHidden
          ? apps
          : apps.filter(
              (app) =>
                (app.manifest.hidden !== undefined
                  ? !app.manifest.hidden
                  : !app.manifest.overlay) && !!app.manifest.frontend?.entry,
            ),
    });

    getAppMetrics
      .mockReturnValueOnce([])
      .mockReturnValueOnce([
        metric(111, 6, 1800, 2200),
        metric(333, 4, 900, 1100, {
          type: "Utility",
          serviceName: "eden-backend-com.eden.visible",
        }),
        metric(999, 2, 3500, 4200, {
          type: "GPU",
          name: "Zulu Process",
        }),
        metric(998, 9, 1200, 1600, {
          type: "Browser",
          name: "Alpha Process",
        }),
        metric(222, 1, 450, 650),
      ])
      .mockReturnValueOnce([
        metric(111, 12, 2000, 2500),
        metric(333, 8, 1000, 1200, {
          type: "Utility",
          serviceName: "eden-backend-com.eden.visible",
        }),
        metric(999, 5, 4000, 4500, {
          type: "GPU",
          name: "Zulu Process",
        }),
        metric(998, 7, 1300, 1700, {
          type: "Browser",
          name: "Alpha Process",
        }),
        metric(222, 3, 500, 700),
      ])
      .mockReturnValue([
        metric(111, 10, 2100, 2550),
        metric(333, 7, 1050, 1300, {
          type: "Utility",
          serviceName: "eden-backend-com.eden.visible",
        }),
        metric(999, 4, 4100, 4550, {
          type: "GPU",
          name: "Zulu Process",
        }),
        metric(998, 6, 1400, 1800, {
          type: "Browser",
          name: "Alpha Process",
        }),
        metric(222, 4, 550, 750),
      ]);

    const visibleOnlyPromise = metrics.getMetrics(false, 3000);

    await metrics.advance(1000);
    const visibleOnly = await visibleOnlyPromise;

    expect(getAppMetrics).toHaveBeenCalledTimes(2);
    expect(visibleOnly.apps).toHaveLength(1);
    expect(visibleOnly.sampledAt).toBe("1970-01-01T00:00:01.000Z");
    expect(visibleOnly.apps[0]).toMatchObject({
      instance: { manifest: { id: "com.eden.visible" } },
      totalCPUPercent: 10,
      totalMemoryWorkingSetSize: 2700,
      totalMemoryPeakWorkingSetSize: 3300,
      renderer: { pid: 111, category: "renderer", viewId: 10 },
      backend: {
        pid: 333,
        category: "backend",
        serviceName: "eden-backend-com.eden.visible",
      },
    });
    expect(
      visibleOnly.sharedProcesses.map((entry) => ({
        pid: entry.pid,
        name: entry.name,
      })),
    ).toEqual([
      { pid: 998, name: "Alpha Process" },
      { pid: 999, name: "Zulu Process" },
    ]);
    expect(visibleOnly.totals).toMatchObject({
      appCPUPercent: 10,
      sharedCPUPercent: 11,
      overallCPUPercent: 21,
      appMemoryWorkingSetSize: 2700,
      sharedMemoryWorkingSetSize: 4700,
      overallMemoryWorkingSetSize: 7400,
    });

    await metrics.advance(1000);
    expect(getAppMetrics).toHaveBeenCalledTimes(3);

    const includingHidden = await metrics.getMetrics(true, 3000);

    expect(getAppMetrics).toHaveBeenCalledTimes(3);
    expect(includingHidden.apps).toHaveLength(2);
    expect(includingHidden.sampledAt).toBe("1970-01-01T00:00:02.000Z");
    expect(
      includingHidden.apps.map((entry) => entry.instance.manifest.id),
    ).toEqual(["com.eden.hidden", "com.eden.visible"]);
    expect(includingHidden.apps[0].totalCPUPercent).toBe(3);
    expect(includingHidden.apps[1].totalCPUPercent).toBe(20);
    expect(
      includingHidden.sharedProcesses.map((entry) => ({
        pid: entry.pid,
        name: entry.name,
      })),
    ).toEqual([
      { pid: 998, name: "Alpha Process" },
      { pid: 999, name: "Zulu Process" },
    ]);
    await metrics.advance(2999);
    expect(getAppMetrics).toHaveBeenCalledTimes(5);
    await metrics.advance(1);
    await metrics.advance(1000);
    expect(getAppMetrics).toHaveBeenCalledTimes(5);
  });

  it("can return an immediate cold-start sample without waiting for the first CPU interval", async () => {
    const visibleApp = createApp("com.eden.visible", 10);

    const metrics = await createMetricsFixture({
      backends: {
        getBackend: jest.fn(() => undefined),
      },
      views: {
        getView: jest.fn(() => createMockView(111)),
      },
      getRunningApps: () => [visibleApp],
    });

    getAppMetrics
      .mockReturnValueOnce([metric(111, 0, 1800, 2200)])
      .mockReturnValue([metric(111, 5, 2000, 2500)]);

    const snapshot = await metrics.getMetrics(false, 3000, false);

    expect(snapshot.sampledAt).toBe("1970-01-01T00:00:00.000Z");
    expect(getAppMetrics).toHaveBeenCalledTimes(1);
    expect(snapshot.apps).toHaveLength(1);
    expect(snapshot.apps[0]).toMatchObject({
      totalCPUPercent: 0,
      totalMemoryWorkingSetSize: 1800,
      renderer: { pid: 111, category: "renderer" },
    });

    await metrics.advance(1000);
    expect(getAppMetrics).toHaveBeenCalledTimes(2);
  });

  const createEmptyMetrics = () =>
    createMetricsFixture({
      backends: { getBackend: () => undefined },
      views: { getView: () => undefined },
      getRunningApps: () => [],
    });

  it("shares the first sample without letting an interrupted reader cancel other readers", async () => {
    getAppMetrics.mockReturnValue([]);
    const metrics = await createEmptyMetrics();
    const interrupted = metrics.forkMetrics();
    const first = metrics.getMetrics();
    const second = metrics.getMetrics();
    let settled = false;
    const samples = Promise.all([first, second]).then((values) => {
      settled = true;
      return values;
    });

    await Effect.runPromise(Fiber.interrupt(interrupted));
    await metrics.advance(999);
    expect(settled).toBe(false);
    await metrics.advance(1);
    const [left, right] = await samples;
    expect(left).toEqual(right);
    expect(left.apps).toEqual([]);
    expect(getAppMetrics).toHaveBeenCalledTimes(2);
  });

  it("stops an idle sampler after every waiting reader is interrupted and starts a fresh sample", async () => {
    getAppMetrics.mockReturnValue([]);
    const metrics = await createEmptyMetrics();
    const interrupted = metrics.forkMetrics();
    await Effect.runPromise(Fiber.interrupt(interrupted));

    await metrics.advance(1000);
    expect(getAppMetrics).toHaveBeenCalledTimes(1);

    const next = metrics.getMetrics();
    await metrics.advance(1000);
    await expect(next).resolves.toMatchObject({ apps: [] });
    expect(getAppMetrics).toHaveBeenCalledTimes(3);
  });

  it("fails all waiting readers when sampling fails and lets the next request retry", async () => {
    getAppMetrics
      .mockReturnValueOnce([])
      .mockImplementationOnce(() => {
        throw new Error("Metrics unavailable");
      })
      .mockReturnValue([]);
    const metrics = await createEmptyMetrics();
    const first = expect(metrics.getMetrics()).rejects.toThrow(
      "Metrics unavailable",
    );
    const second = expect(metrics.getMetrics()).rejects.toThrow(
      "Metrics unavailable",
    );

    await metrics.advance(1000);
    await Promise.all([first, second]);

    const next = metrics.getMetrics();
    await metrics.advance(1000);
    await expect(next).resolves.toMatchObject({ apps: [] });
    expect(getAppMetrics).toHaveBeenCalledTimes(4);
  });
});

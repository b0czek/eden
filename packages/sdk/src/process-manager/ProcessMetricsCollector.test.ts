import "reflect-metadata";

import type { AppInstance } from "@edenapp/types";
import { app } from "electron";
import { ProcessMetricsCollector } from "./ProcessMetricsCollector";

jest.mock("electron", () => ({
  app: {
    getAppMetrics: jest.fn(),
  },
}));

const getAppMetrics = (app as unknown as { getAppMetrics: jest.Mock })
  .getAppMetrics;

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

describe("ProcessMetricsCollector", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getAppMetrics.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("uses a fixed main-process sampling cadence and lets callers extend sampler keepalive", async () => {
    const visibleApp = createApp("com.eden.visible", 10, {
      manifest: {
        id: "com.eden.visible",
        name: "Zulu",
        version: "1.0.0",
        frontend: { entry: "dist/index.html" },
        permissions: [],
      } as any,
    });
    const hiddenApp = createApp("com.eden.hidden", 20, {
      manifest: {
        id: "com.eden.hidden",
        name: "Alpha",
        version: "1.0.0",
        frontend: { entry: "dist/index.html" },
        overlay: true,
        permissions: [],
      } as any,
    });

    const apps = [visibleApp, hiddenApp];
    const getView = jest.fn((viewId: number) => {
      const pidByViewId: Record<number, number> = { 10: 111, 20: 222 };
      const pid = pidByViewId[viewId];
      if (!pid) return undefined;
      return {
        webContents: {
          isDestroyed: () => false,
          getOSProcessId: () => pid,
        },
      };
    });
    const getBackend = jest.fn((appId: string) =>
      appId === "com.eden.visible" ? { pid: 333 } : undefined,
    );

    const collector = new ProcessMetricsCollector({
      backendManager: { getBackend } as any,
      viewManager: { getView } as any,
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

    const visibleOnlyPromise = collector.getMetrics(false, 3000);

    await jest.advanceTimersByTimeAsync(1000);
    const visibleOnly = await visibleOnlyPromise;

    expect(getAppMetrics).toHaveBeenCalledTimes(2);
    expect(visibleOnly.apps).toHaveLength(1);
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

    await jest.advanceTimersByTimeAsync(1000);
    expect(getAppMetrics).toHaveBeenCalledTimes(3);

    const includingHidden = await collector.getMetrics(true, 3000);

    expect(getAppMetrics).toHaveBeenCalledTimes(3);
    expect(includingHidden.apps).toHaveLength(2);
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
  });

  it("can return an immediate cold-start sample without waiting for the first CPU interval", async () => {
    const visibleApp = createApp("com.eden.visible", 10);

    const collector = new ProcessMetricsCollector({
      backendManager: { getBackend: jest.fn(() => undefined) } as any,
      viewManager: {
        getView: jest.fn(() => ({
          webContents: {
            isDestroyed: () => false,
            getOSProcessId: () => 111,
          },
        })),
      } as any,
      getRunningApps: () => [visibleApp],
    });

    getAppMetrics
      .mockReturnValueOnce([metric(111, 0, 1800, 2200)])
      .mockReturnValue([metric(111, 5, 2000, 2500)]);

    const snapshot = await collector.getMetrics(false, 3000, false);

    expect(getAppMetrics).toHaveBeenCalledTimes(1);
    expect(snapshot.apps).toHaveLength(1);
    expect(snapshot.apps[0]).toMatchObject({
      totalCPUPercent: 0,
      totalMemoryWorkingSetSize: 1800,
      renderer: { pid: 111, category: "renderer" },
    });

    await jest.advanceTimersByTimeAsync(1000);
    expect(getAppMetrics).toHaveBeenCalledTimes(2);
  });
});

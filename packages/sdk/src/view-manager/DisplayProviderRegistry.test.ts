import "reflect-metadata";

import type { ViewManager } from "./ViewManager";
import { DisplayProviderRegistry } from "./DisplayProviderRegistry";
import { ViewInfo } from "./types";

type ViewManagerMock = jest.Mocked<
  Pick<ViewManager, "getViewIdByWebContentsId" | "getViewInfo">
>;

const createViewInfo = (isDestroyed = false): ViewInfo =>
  ({
    view: {
      webContents: {
        isDestroyed: jest.fn(() => isDestroyed),
      },
    },
  }) as unknown as ViewInfo;

const createRegistry = () => {
  const viewManager: ViewManagerMock = {
    getViewIdByWebContentsId: jest.fn((webContentsId: number) => {
      if (webContentsId === 100) return 10;
      if (webContentsId === 200) return 20;
      return undefined;
    }),
    getViewInfo: jest.fn((viewId: number) => {
      if (viewId === 10) return createViewInfo();
      if (viewId === 20) return createViewInfo();
      return undefined;
    }),
  };

  return {
    registry: new DisplayProviderRegistry(viewManager, "Test"),
    viewManager,
  };
};

describe("DisplayProviderRegistry", () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("registers a valid provider and exposes it", () => {
    const { registry } = createRegistry();

    expect(
      registry.register({ appId: "com.example.provider", webContentsId: 100 }),
    ).toEqual({ success: true });

    expect(registry.getProvider()).toEqual({
      appId: "com.example.provider",
      viewId: 10,
    });
  });

  it("rejects registration without a valid app view", () => {
    const { registry } = createRegistry();

    expect(() =>
      registry.register({
        appId: "com.example.provider",
        webContentsId: 999,
      }),
    ).toThrow(/display provider must be a valid view/);
    expect(() => registry.register({ webContentsId: 100 })).toThrow(
      /display provider must be a valid view/,
    );
  });

  it("matches provider callers by registered view", () => {
    const { registry } = createRegistry();
    registry.register({ appId: "com.example.provider", webContentsId: 100 });

    expect(
      registry.isProvider({
        appId: "com.example.provider",
        webContentsId: 100,
      }),
    ).toBe(true);
    expect(
      registry.isProvider({
        appId: "com.example.provider",
        webContentsId: 200,
      }),
    ).toBe(false);
  });

  it("waits for matching app registration", async () => {
    const { registry } = createRegistry();

    const ready = registry.waitFor("com.example.provider", 5000);
    registry.register({ appId: "com.example.provider", webContentsId: 100 });

    await expect(ready).resolves.toBeUndefined();
  });

  it("throws on wrong-app registration while waiting for a provider", async () => {
    jest.useFakeTimers();
    try {
      const { registry } = createRegistry();
      const ready = registry.waitFor("com.example.provider", 5000);

      expect(() =>
        registry.register({
          appId: "com.example.other",
          webContentsId: 100,
        }),
      ).toThrow(/does not match expected app/);

      jest.advanceTimersByTime(5000);
      await expect(ready).rejects.toThrow(
        /Timed out waiting for Test display provider/,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects waiters on timeout", async () => {
    jest.useFakeTimers();
    try {
      const { registry } = createRegistry();
      const ready = registry.waitFor("com.example.provider", 5000);

      jest.advanceTimersByTime(5000);

      await expect(ready).rejects.toThrow(
        /Timed out waiting for Test display provider/,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("clears matching stopped apps only", () => {
    const { registry } = createRegistry();
    registry.register({ appId: "com.example.provider", webContentsId: 100 });

    expect(registry.clearIfAppStopped("com.example.other")).toBe(false);
    expect(registry.getProvider()).toEqual({
      appId: "com.example.provider",
      viewId: 10,
    });

    expect(registry.clearIfAppStopped("com.example.provider")).toBe(true);
    expect(registry.getProvider()).toBeNull();
  });

  it("does not treat destroyed provider views as alive", () => {
    const { registry, viewManager } = createRegistry();
    registry.register({ appId: "com.example.provider", webContentsId: 100 });
    viewManager.getViewInfo.mockReturnValue(createViewInfo(true));

    expect(registry.isProviderAlive()).toBe(false);
    expect(registry.getProvider()).toBeNull();
    expect(registry.clearIfStale()).toBe(true);
  });
});

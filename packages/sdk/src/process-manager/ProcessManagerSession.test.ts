import "reflect-metadata";

import { ProcessManager } from "./ProcessManager";

describe("ProcessManager session cleanup", () => {
  it("launches backend-only apps as ordinary session processes", async () => {
    const manager = Object.create(ProcessManager.prototype) as ProcessManager;
    Object.assign(manager, {
      appCatalog: {
        get: () => ({
          id: "app.backend",
          backend: { entry: "backend.js" },
        }),
      },
      config: { development: false },
      executionContext: { canLaunchApp: () => true },
      sessionContext: {
        getCurrentUser: () => ({ username: "operator" }),
        getSessionId: () => "s1",
      },
    });
    const launch = jest
      .spyOn(
        manager as unknown as {
          launchAppInternal: (...args: unknown[]) => Promise<{
            success: boolean;
            instanceId: string;
            appId: string;
          }>;
        },
        "launchAppInternal",
      )
      .mockResolvedValue({
        success: true,
        instanceId: "instance",
        appId: "app.backend",
      });

    await expect(manager.launchApp("app.backend")).resolves.toMatchObject({
      appId: "app.backend",
    });
    expect(launch).toHaveBeenCalledWith("app.backend", undefined, undefined, {
      owner: { kind: "session", sessionId: "s1", username: "operator" },
      principal: { kind: "user", username: "operator" },
    });
  });

  it("attempts to stop every app and reports aggregate failure", async () => {
    const manager = Object.create(ProcessManager.prototype) as ProcessManager;
    Object.assign(manager, {
      runningApps: new Map([
        [
          "app.one",
          {
            manifest: { id: "app.one" },
            owner: { kind: "session", sessionId: "s1" },
          },
        ],
        [
          "app.two",
          {
            manifest: { id: "app.two" },
            owner: { kind: "session", sessionId: "s1" },
          },
        ],
        [
          "app.three",
          {
            manifest: { id: "app.three" },
            owner: { kind: "session", sessionId: "s1" },
          },
        ],
      ]),
      sessionContext: { getSessionId: () => "s1" },
    });
    const stopApp = jest.spyOn(
      manager as unknown as {
        stopApp: (appId: string) => Promise<void>;
      },
      "stopApp",
    );
    stopApp.mockImplementation(async (appId) => {
      if (appId === "app.two") throw new Error("stop failed");
    });

    await expect(manager.stopSessionApps()).rejects.toThrow(
      "Failed to stop all session apps",
    );
    expect(stopApp.mock.calls.map(([appId]) => appId)).toEqual([
      "app.one",
      "app.two",
      "app.three",
    ]);
  });

  it("leaves system-owned daemons running", async () => {
    const manager = Object.create(ProcessManager.prototype) as ProcessManager;
    Object.assign(manager, {
      runningApps: new Map([
        [
          "app.session",
          {
            manifest: { id: "app.session" },
            owner: { kind: "session", sessionId: "s1" },
          },
        ],
        [
          "app.daemon",
          { manifest: { id: "app.daemon" }, owner: { kind: "system" } },
        ],
      ]),
      sessionContext: { getSessionId: () => "s1" },
    });
    const stop = jest
      .spyOn(
        manager as unknown as {
          stopApp: (appId: string) => Promise<void>;
        },
        "stopApp",
      )
      .mockResolvedValue(undefined);

    await manager.stopSessionApps();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledWith("app.session");
  });

  it("preserves session identity when reloading outside a user context", async () => {
    const instance = {
      manifest: { id: "app.hot-reload" },
      instanceId: "instance",
      owner: {
        kind: "session" as const,
        sessionId: "s1",
        username: "operator",
      },
      principal: { kind: "user" as const, username: "operator" },
      installPath: "/apps/app.hot-reload",
      viewId: -1,
      state: "running" as const,
      installedAt: new Date(),
      lastLaunched: new Date(),
    };
    const profile = {
      username: "operator",
      name: "Operator",
      role: "user" as const,
      grants: ["apps/launch/app.hot-reload"],
    };
    const manager = Object.create(ProcessManager.prototype) as ProcessManager;
    Object.assign(manager, {
      runningApps: new Map([["app.hot-reload", instance]]),
      viewManager: { getViewInfo: () => undefined },
      runtimeContexts: { get: () => ({ profile }) },
      executionContext: { canLaunchApp: () => false },
    });
    jest
      .spyOn(
        manager as unknown as { stopApp: (appId: string) => Promise<void> },
        "stopApp",
      )
      .mockResolvedValue(undefined);
    const launch = jest
      .spyOn(
        manager as unknown as {
          launchAppInternal: (...args: unknown[]) => Promise<{
            success: boolean;
            instanceId: string;
            appId: string;
          }>;
        },
        "launchAppInternal",
      )
      .mockResolvedValue({
        success: true,
        instanceId: "replacement",
        appId: "app.hot-reload",
      });

    await manager.reloadApp("app.hot-reload");

    expect(launch).toHaveBeenCalledWith(
      "app.hot-reload",
      undefined,
      undefined,
      {
        owner: instance.owner,
        principal: instance.principal,
        profile,
      },
    );
  });
});

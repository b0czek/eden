import "reflect-metadata";

import { EventEmitter } from "node:events";
import type { RuntimeAppManifest, UserProfile } from "@edenapp/types";
import type { AppCatalog } from "../app-registry";
import { ExecutionContext } from "../execution/ExecutionContext";
import type { CommandRegistry, IPCBridge } from "../ipc";
import type { PackageManager } from "../package-manager/PackageManager";
import type { ProcessManager } from "../process-manager/ProcessManager";
import type { SettingsManager } from "../settings";
import type { UserManager } from "../user/UserManager";
import { DaemonManager } from "./DaemonManager";

const manifest = {
  id: "com.example.daemon",
  name: "Example daemon",
  version: "1.0.0",
  backend: { entry: "backend.js" },
} as RuntimeAppManifest;

describe("DaemonManager", () => {
  const definitions = new Map<string, string>();
  let processManager: EventEmitter & {
    launchDaemon: jest.Mock;
    stopApp: jest.Mock;
    getAppInstance: jest.Mock;
  };
  let manager: DaemonManager;
  let executionContext: ExecutionContext;
  let getUser: jest.Mock<Promise<UserProfile | null>, [string]>;

  beforeEach(() => {
    definitions.clear();
    processManager = Object.assign(new EventEmitter(), {
      launchDaemon: jest.fn().mockResolvedValue({
        success: true,
        appId: manifest.id,
        instanceId: "instance",
      }),
      stopApp: jest.fn().mockResolvedValue(undefined),
      getAppInstance: jest.fn().mockReturnValue(undefined),
    });
    executionContext = new ExecutionContext({});
    getUser = jest.fn().mockResolvedValue(null);
    manager = new DaemonManager(
      { eventSubscribers: { notify: jest.fn() } } as unknown as IPCBridge,
      { registerManager: jest.fn() } as unknown as CommandRegistry,
      {
        all: () => [manifest],
        get: (appId: string) => (appId === manifest.id ? manifest : undefined),
      } as unknown as AppCatalog,
      processManager as unknown as ProcessManager,
      {
        list: jest
          .fn()
          .mockImplementation(async () =>
            Array.from(definitions.keys()).map((key) =>
              key.slice("com.eden:".length),
            ),
          ),
        get: jest
          .fn()
          .mockImplementation(async (appId: string, key: string) =>
            definitions.get(`${appId}:${key}`),
          ),
        set: jest
          .fn()
          .mockImplementation(
            async (appId: string, key: string, value: string) => {
              definitions.set(`${appId}:${key}`, value);
            },
          ),
        delete: jest.fn(),
      } as unknown as SettingsManager,
      { getUser } as unknown as UserManager,
      executionContext,
      { on: jest.fn() } as unknown as PackageManager,
    );
  });

  it("discovers backend-only apps as disabled unassigned daemons", async () => {
    await manager.initialize();
    await expect(manager.list()).resolves.toMatchObject([
      {
        appId: manifest.id,
        state: "inactive",
        definition: {
          enabled: false,
          runAs: null,
          restart: "on-failure",
        },
      },
    ]);
  });

  it("adopts persisted edits immediately without restarting", async () => {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: ["preset/daemon/manage"],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockResolvedValue(operator);
    await manager.initialize();
    await manager.updateDefinition({
      appId: manifest.id,
      enabled: true,
      runAs: { kind: "user", username: operator.username },
      restart: "always",
    });

    expect(processManager.launchDaemon).not.toHaveBeenCalled();
    expect((await manager.list())[0]).toMatchObject({
      definition: {
        enabled: true,
        runAs: { kind: "user", username: operator.username },
        restart: "always",
      },
      restartRequired: false,
    });
    expect(processManager.launchDaemon).not.toHaveBeenCalled();
  });

  it("requires an assigned account before enabling or starting", async () => {
    await manager.initialize();
    await expect(manager.setEnabled(manifest.id, true)).rejects.toThrow(
      "requires a runAs account",
    );
    await expect(manager.start(manifest.id)).rejects.toThrow(
      "requires a runAs account",
    );
  });

  it("applies restart policy when process/stop terminates a supervised daemon", async () => {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockResolvedValue(operator);
    await manager.initialize();
    await manager.updateDefinition({
      appId: manifest.id,
      enabled: true,
      runAs: { kind: "user", username: operator.username },
      restart: "always",
    });
    await manager.start(manifest.id);

    processManager.emit("stopped", { appId: manifest.id });

    expect((await manager.list())[0]).toMatchObject({
      state: "backoff",
      restartCount: 1,
    });
    await manager.shutdown();
  });

  it("suppresses restart policy for daemon/stop", async () => {
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockResolvedValue(operator);
    await manager.initialize();
    await manager.updateDefinition({
      appId: manifest.id,
      enabled: true,
      runAs: { kind: "user", username: operator.username },
      restart: "always",
    });
    await manager.start(manifest.id);
    processManager.getAppInstance.mockReturnValue({
      manifest,
      principal: { kind: "user", username: operator.username },
    });
    processManager.stopApp.mockImplementation(async () => {
      processManager.getAppInstance.mockReturnValue(undefined);
      processManager.emit("stopped", { appId: manifest.id });
    });

    await manager.stop(manifest.id);

    expect((await manager.list())[0]).toMatchObject({
      state: "inactive",
      restartCount: 0,
    });
  });

  it("does not let a non-vendor assign a vendor daemon principal", async () => {
    const vendor: UserProfile = {
      username: "vendor",
      name: "Vendor",
      role: "vendor",
      grants: ["*"],
      createdAt: 1,
      updatedAt: 1,
    };
    const operator: UserProfile = {
      username: "operator",
      name: "Operator",
      role: "standard",
      grants: ["preset/daemon/manage"],
      createdAt: 1,
      updatedAt: 1,
    };
    getUser.mockResolvedValue(vendor);

    await expect(
      executionContext.run(
        { principal: { kind: "user", profile: operator } },
        () =>
          manager.updateDefinition({
            appId: manifest.id,
            enabled: true,
            runAs: { kind: "user", username: vendor.username },
            restart: "on-failure",
          }),
      ),
    ).rejects.toThrow("Only a vendor");
    expect(definitions.size).toBe(0);

    await expect(
      executionContext.run(
        { principal: { kind: "user", profile: vendor } },
        () =>
          manager.updateDefinition({
            appId: manifest.id,
            enabled: true,
            runAs: { kind: "user", username: vendor.username },
            restart: "on-failure",
          }),
      ),
    ).resolves.toBeUndefined();
  });
});

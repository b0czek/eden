import "reflect-metadata";

import { EventSubscriberManager } from "./EventSubscriberManager";
import { registerEventPermission } from "./PermissionRegistry";

import type { PermissionRegistry } from "./PermissionRegistry";
import type { BackendManager } from "../process-manager/BackendManager";
import type { ViewManager } from "../view-manager/ViewManager";

describe("EventSubscriberManager", () => {
  let viewManager: jest.Mocked<Pick<ViewManager, "getViewInfo" | "sendToView" | "sendToMainWindow">>;
  let backendManager: jest.Mocked<Pick<BackendManager, "sendMessage">>;
  let permissionRegistry: jest.Mocked<Pick<PermissionRegistry, "hasPermission">>;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    viewManager = {
      getViewInfo: jest.fn(),
      sendToView: jest.fn(),
      sendToMainWindow: jest.fn(),
    } as any;

    backendManager = {
      sendMessage: jest.fn(),
    } as any;

    permissionRegistry = {
      hasPermission: jest.fn(),
    } as any;

    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("returns false when subscribing an unknown view", () => {
    const manager = new EventSubscriberManager(viewManager as any);

    viewManager.getViewInfo.mockReturnValue(undefined);

    expect(manager.subscribe(1, "event/missing")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith("Cannot subscribe: view 1 not found");
  });

  it("enforces event permissions when a registry is set", () => {
    const manager = new EventSubscriberManager(viewManager as any);
    manager.setPermissionRegistry(permissionRegistry as any);

    registerEventPermission("event/secure", "permissions/secure");

    viewManager.getViewInfo.mockReturnValue({ appId: "app.one" } as any);
    permissionRegistry.hasPermission.mockReturnValue(false);

    expect(() => manager.subscribe(1, "event/secure")).toThrow(
      "Permission denied: permissions/secure required to subscribe to event/secure"
    );
  });

  it("subscribes/unsubscribes views and sends notifications", () => {
    const manager = new EventSubscriberManager(viewManager as any);
    manager.setBackendManager(backendManager as any);

    viewManager.getViewInfo.mockReturnValue({ appId: "app.one" } as any);

    expect(manager.subscribe(7, "event/ping")).toBe(true);
    expect(manager.getSubscribedViews("event/ping")).toEqual([7]);

    manager.subscribeFoundation("event/ping");
    manager.subscribeBackend("app.backend", "event/ping");

    manager.notify("event/ping", { ok: true });

    expect(viewManager.sendToMainWindow).toHaveBeenCalledWith("shell-message", {
      type: "event/ping",
      payload: { ok: true },
    });
    expect(viewManager.sendToView).toHaveBeenCalledWith(7, "shell-message", {
      type: "event/ping",
      payload: { ok: true },
    });
    expect(backendManager.sendMessage).toHaveBeenCalledWith("app.backend", {
      type: "shell-event",
      eventName: "event/ping",
      payload: { ok: true },
    });

    expect(manager.unsubscribe(7, "event/ping")).toBe(true);
    expect(manager.getSubscribedViews("event/ping")).toEqual([]);
  });

  it("notifies internal subscribers and tolerates callback errors", () => {
    const manager = new EventSubscriberManager(viewManager as any);

    const callback = jest.fn();
    const failing = jest.fn(() => {
      throw new Error("boom");
    });

    manager.subscribeInternal("event/internal" as any, callback as any);
    manager.subscribeInternal("event/internal" as any, failing as any);

    manager.notify("event/internal", { data: 1 });

    expect(callback).toHaveBeenCalledWith({ data: 1 });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("sends to a specific view only when subscribed", () => {
    const manager = new EventSubscriberManager(viewManager as any);
    viewManager.getViewInfo.mockReturnValue({ appId: "app.one" } as any);

    expect(manager.notifyView(2, "event/one", {})).toBe(false);

    manager.subscribe(2, "event/one");
    viewManager.sendToView.mockReturnValue(true as any);
    expect(manager.notifyView(2, "event/one", { ok: true })).toBe(true);
    expect(viewManager.sendToView).toHaveBeenCalledWith(2, "shell-message", {
      type: "event/one",
      payload: { ok: true },
    });
  });

  it("cleans up subscriptions for views and backends", () => {
    const manager = new EventSubscriberManager(viewManager as any);
    manager.setBackendManager(backendManager as any);

    viewManager.getViewInfo.mockReturnValue({ appId: "app.one" } as any);

    manager.subscribe(3, "event/a");
    manager.subscribe(3, "event/b");

    manager.subscribeBackend("app.backend", "event/a");
    manager.subscribeBackend("app.backend", "event/b");

    manager.removeViewSubscriptions(3);
    manager.removeBackendSubscriptions("app.backend");

    expect(manager.getSubscribedViews("event/a")).toEqual([]);
    expect(manager.getSubscribedViews("event/b")).toEqual([]);
    expect(manager.getSubscribedBackends("event/a")).toEqual([]);
    expect(manager.getSubscribedBackends("event/b")).toEqual([]);
  });
});

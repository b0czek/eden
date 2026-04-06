import "reflect-metadata";

import type { BackendManager } from "../process-manager/BackendManager";
import type { ViewManager } from "../view-manager/ViewManager";
import { EventSubscriberManager } from "./EventSubscriberManager";
import type { PermissionRegistry } from "./PermissionRegistry";
import { registerEventPermission } from "./PermissionRegistry";

type ViewManagerMock = jest.Mocked<
  Pick<ViewManager, "getViewInfo" | "sendToView" | "sendToMainWindow">
>;
type BackendManagerMock = jest.Mocked<Pick<BackendManager, "sendMessage">>;
type PermissionRegistryMock = jest.Mocked<
  Pick<PermissionRegistry, "hasPermission">
>;
type ViewInfo = NonNullable<ReturnType<ViewManager["getViewInfo"]>>;

const createViewManagerMock = (): ViewManagerMock => ({
  getViewInfo: jest.fn(),
  sendToView: jest.fn(),
  sendToMainWindow: jest.fn(),
});

const createBackendManagerMock = (): BackendManagerMock => ({
  sendMessage: jest.fn(),
});

const createPermissionRegistryMock = (): PermissionRegistryMock => ({
  hasPermission: jest.fn(),
});

const createViewInfo = (appId: string = "app.one"): ViewInfo =>
  ({ appId }) as ViewInfo;

const createManager = (viewManager: ViewManagerMock): EventSubscriberManager =>
  new EventSubscriberManager(viewManager as unknown as ViewManager);

describe("EventSubscriberManager", () => {
  let viewManager: ViewManagerMock;
  let backendManager: BackendManagerMock;
  let permissionRegistry: PermissionRegistryMock;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    viewManager = createViewManagerMock();
    backendManager = createBackendManagerMock();
    permissionRegistry = createPermissionRegistryMock();

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
    const manager = createManager(viewManager);

    viewManager.getViewInfo.mockReturnValue(undefined);

    expect(manager.subscribe(1, "event/missing")).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith("Cannot subscribe: view 1 not found");
  });

  it("enforces event permissions when a registry is set", () => {
    const manager = createManager(viewManager);
    manager.setPermissionRegistry(
      permissionRegistry as unknown as PermissionRegistry,
    );

    registerEventPermission("event/secure", "permissions/secure");

    viewManager.getViewInfo.mockReturnValue(createViewInfo());
    permissionRegistry.hasPermission.mockReturnValue(false);

    expect(() => manager.subscribe(1, "event/secure")).toThrow(
      "Permission denied: permissions/secure required to subscribe to event/secure",
    );
  });

  it("subscribes/unsubscribes views and sends notifications", () => {
    const manager = createManager(viewManager);
    manager.setBackendManager(backendManager as unknown as BackendManager);

    viewManager.getViewInfo.mockReturnValue(createViewInfo());

    expect(manager.subscribe(7, "settings/changed")).toBe(true);
    expect(manager.getSubscribedViews("settings/changed")).toEqual([7]);

    manager.subscribeFoundation("settings/changed");
    manager.subscribeBackend("app.backend", "settings/changed");

    manager.notify("settings/changed", {
      appId: "app.one",
      key: "general.locale",
      value: "en",
    });

    expect(viewManager.sendToMainWindow).toHaveBeenCalledWith("shell-message", {
      type: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });
    expect(viewManager.sendToView).toHaveBeenCalledWith(7, "shell-message", {
      type: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });
    expect(backendManager.sendMessage).toHaveBeenCalledWith("app.backend", {
      type: "shell-event",
      eventName: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });

    expect(manager.unsubscribe(7, "settings/changed")).toBe(true);
    expect(manager.getSubscribedViews("settings/changed")).toEqual([]);
  });

  it("notifies internal subscribers and tolerates callback errors", () => {
    const manager = createManager(viewManager);

    const callback = jest.fn(
      (_data: { appId: string; key: string; value: string }) => undefined,
    );
    const failing = jest.fn(
      (_data: { appId: string; key: string; value: string }) => {
        throw new Error("boom");
      },
    );

    manager.subscribeInternal("settings/changed", callback);
    manager.subscribeInternal("settings/changed", failing);

    manager.notify("settings/changed", {
      appId: "app.one",
      key: "general.locale",
      value: "pl",
    });

    expect(callback).toHaveBeenCalledWith({
      appId: "app.one",
      key: "general.locale",
      value: "pl",
    });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("sends to a specific view only when subscribed", () => {
    const manager = createManager(viewManager);
    viewManager.getViewInfo.mockReturnValue(createViewInfo());

    expect(
      manager.notifyView(2, "settings/changed", {
        appId: "app.one",
        key: "general.locale",
        value: "en",
      }),
    ).toBe(false);

    manager.subscribe(2, "settings/changed");
    viewManager.sendToView.mockReturnValue(true);
    expect(
      manager.notifyView(2, "settings/changed", {
        appId: "app.one",
        key: "general.locale",
        value: "en",
      }),
    ).toBe(true);
    expect(viewManager.sendToView).toHaveBeenCalledWith(2, "shell-message", {
      type: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });
  });

  it("cleans up subscriptions for views and backends", () => {
    const manager = createManager(viewManager);
    manager.setBackendManager(backendManager as unknown as BackendManager);

    viewManager.getViewInfo.mockReturnValue(createViewInfo());

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

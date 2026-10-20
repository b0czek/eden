import * as Effect from "effect/Effect";
import {
  buildService,
  createEffectRuntime,
} from "../../tests/support/effect-runtime";
import { ExecutionContext, ExecutionContextLive } from "../execution/context";
import {
  RuntimeContexts,
  RuntimeContextsLive,
} from "../execution/runtime-contexts";
import type { Backends } from "../processes/backends";
import { RuntimeConfig } from "../runtime/inputs";
import { SessionContext, SessionContextLive } from "../session/context";
import type { Views } from "../views/service";
import { createEventRouting, type EventRouting } from "./event-routing";
import type { Permissions } from "./permissions";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

type ViewsMock = jest.Mocked<
  Pick<Views, "getViewInfo" | "sendToView" | "sendToMainWindow">
>;
type BackendsMock = jest.Mocked<Pick<Backends, "sendMessage">>;
type PermissionsMock = jest.Mocked<
  Pick<Permissions, "getEventPermission" | "hasPermission">
>;
type ViewInfo = NonNullable<ReturnType<Views["getViewInfo"]>>;

const createViewsMock = (): ViewsMock => ({
  getViewInfo: jest.fn(),
  sendToView: jest.fn(),
  sendToMainWindow: jest.fn(),
});

const createBackendsMock = (): BackendsMock => ({
  sendMessage: jest.fn(),
});

const createPermissionsMock = (): PermissionsMock => ({
  getEventPermission: jest.fn(),
  hasPermission: jest.fn(),
});

const createViewInfo = (appId: string = "app.one"): ViewInfo =>
  ({ appId }) as ViewInfo;

const createRoutingFixture = (
  views: ViewsMock,
  backends: BackendsMock,
  permissions: PermissionsMock,
): EventRouting =>
  createEventRouting({
    views,
    backends,
    permissions,
    execution: serviceEffects.acquireSync(
      buildService(ExecutionContext, ExecutionContextLive).pipe(
        Effect.provideService(RuntimeConfig, {}),
      ),
    ),
    contexts: serviceEffects.acquireSync(
      buildService(RuntimeContexts, RuntimeContextsLive).pipe(
        Effect.provideService(
          SessionContext,
          serviceEffects.acquireSync(
            buildService(SessionContext, SessionContextLive),
          ),
        ),
      ),
    ),
  });

describe("EventRouting", () => {
  let views: ViewsMock;
  let backends: BackendsMock;
  let permissions: PermissionsMock;
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    views = createViewsMock();
    backends = createBackendsMock();
    permissions = createPermissionsMock();

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
    const routing = createRoutingFixture(views, backends, permissions);

    views.getViewInfo.mockReturnValue(undefined);

    expect(routing.subscribe(1, "event/missing")).toBe(false);
  });

  it("enforces the event permission configured for a subscription", () => {
    const routing = createRoutingFixture(views, backends, permissions);

    views.getViewInfo.mockReturnValue(createViewInfo());
    permissions.getEventPermission.mockReturnValue("permissions/secure");
    permissions.hasPermission.mockReturnValue(false);

    expect(() => routing.subscribe(1, "event/secure")).toThrow(
      "Permission denied: permissions/secure required to subscribe to event/secure",
    );
  });

  it("subscribes/unsubscribes views and sends notifications", () => {
    const routing = createRoutingFixture(views, backends, permissions);

    views.getViewInfo.mockReturnValue(createViewInfo());

    expect(routing.subscribe(7, "settings/changed")).toBe(true);
    expect(routing.getSubscribedViews("settings/changed")).toEqual([7]);

    routing.subscribeFoundation("settings/changed");
    routing.subscribeBackend("app.backend", "settings/changed");

    routing.notify("settings/changed", {
      appId: "app.one",
      key: "general.locale",
      value: "en",
    });

    expect(views.sendToMainWindow).toHaveBeenCalledWith("shell-message", {
      type: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });
    expect(views.sendToView).toHaveBeenCalledWith(7, "shell-message", {
      type: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });
    expect(backends.sendMessage).toHaveBeenCalledWith("app.backend", {
      type: "shell-event",
      eventName: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });

    expect(routing.unsubscribe(7, "settings/changed")).toBe(true);
    expect(routing.getSubscribedViews("settings/changed")).toEqual([]);
  });

  it("sends to a specific view only when subscribed", () => {
    const routing = createRoutingFixture(views, backends, permissions);
    views.getViewInfo.mockReturnValue(createViewInfo());

    expect(
      routing.notifyView(2, "settings/changed", {
        appId: "app.one",
        key: "general.locale",
        value: "en",
      }),
    ).toBe(false);
    expect(views.sendToView).not.toHaveBeenCalled();

    routing.subscribe(2, "settings/changed");
    views.sendToView.mockReturnValue(true);
    expect(
      routing.notifyView(2, "settings/changed", {
        appId: "app.one",
        key: "general.locale",
        value: "en",
      }),
    ).toBe(true);
    expect(views.sendToView).toHaveBeenCalledWith(2, "shell-message", {
      type: "settings/changed",
      payload: { appId: "app.one", key: "general.locale", value: "en" },
    });
    expect(views.sendToView).toHaveBeenCalledTimes(1);

    routing.unsubscribe(2, "settings/changed");
    expect(
      routing.notifyView(2, "settings/changed", {
        appId: "app.one",
        key: "general.locale",
        value: "en",
      }),
    ).toBe(false);
    expect(views.sendToView).toHaveBeenCalledTimes(1);
  });

  it("cleans up subscriptions for views and backends", () => {
    const routing = createRoutingFixture(views, backends, permissions);

    views.getViewInfo.mockReturnValue(createViewInfo());

    routing.subscribe(3, "event/a");
    routing.subscribe(3, "event/b");

    routing.subscribeBackend("app.backend", "event/a");
    routing.subscribeBackend("app.backend", "event/b");

    routing.removeViewSubscriptions(3);
    routing.removeBackendSubscriptions("app.backend");

    expect(routing.getSubscribedViews("event/a")).toEqual([]);
    expect(routing.getSubscribedViews("event/b")).toEqual([]);
    expect(routing.getSubscribedBackends("event/a")).toEqual([]);
    expect(routing.getSubscribedBackends("event/b")).toEqual([]);
  });
});

import "reflect-metadata";

import type { CommandRegistry, IPCBridge } from "../ipc";
import type { ViewManager } from "../view-manager";
import { NotificationManager } from "./NotificationManager";

type EventSubscribersMock = {
  notify: jest.Mock;
  notifyView: jest.Mock;
};

const createManager = () => {
  const eventSubscribers: EventSubscribersMock = {
    notify: jest.fn(),
    notifyView: jest.fn(() => true),
  };
  const ipcBridge = { eventSubscribers } as unknown as IPCBridge;
  const commandRegistry = {
    registerManager: jest.fn(),
  } as unknown as jest.Mocked<Pick<CommandRegistry, "registerManager">>;
  const viewManager = {
    getViewIdByWebContentsId: jest.fn((webContentsId: number) => {
      if (webContentsId === 100) return 10;
      if (webContentsId === 200) return 20;
      return undefined;
    }),
    getViewInfo: jest.fn(() => ({
      view: {
        webContents: {
          isDestroyed: jest.fn(() => false),
        },
      },
    })),
  } as unknown as jest.Mocked<
    Pick<ViewManager, "getViewIdByWebContentsId" | "getViewInfo">
  >;

  const manager = new NotificationManager(
    ipcBridge,
    commandRegistry as unknown as CommandRegistry,
    viewManager as unknown as ViewManager,
  );

  return { commandRegistry, eventSubscribers, manager, viewManager };
};

describe("NotificationManager", () => {
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

  it("pushes notifications with UI actions", () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.toaster",
      webContentsId: 100,
    });
    const notification = manager.pushNotification(
      "Title",
      "Message",
      0,
      "info",
      [{ id: "open", label: "Open" }],
    );

    expect(notification.actions).toEqual([{ id: "open", label: "Open" }]);
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      10,
      "notification/added",
      { notification },
    );
  });

  it("runs internal action callbacks", async () => {
    const { eventSubscribers, manager } = createManager();
    const callback = jest.fn();
    manager.registerDisplayProvider({
      appId: "com.eden.toaster",
      webContentsId: 100,
    });
    const notification = manager.pushNotification(
      "Title",
      "Message",
      0,
      "warning",
      [{ id: "force", label: "Force open" }],
      { force: callback },
    );

    await expect(
      manager.handleActionClicked(notification.id, "force", {
        appId: "com.eden.toaster",
        webContentsId: 100,
      }),
    ).resolves.toEqual({ success: true });
    expect(callback).toHaveBeenCalledWith(notification);
    expect(eventSubscribers.notify).not.toHaveBeenCalledWith(
      "notification/action-clicked",
      expect.any(Object),
    );
  });

  it("routes renderer-owned action clicks to the original view", async () => {
    const { eventSubscribers, manager } = createManager();
    manager.registerDisplayProvider({
      appId: "com.eden.toaster",
      webContentsId: 100,
    });
    const notification = manager.pushNotification(
      "Title",
      "Message",
      5000,
      "info",
      [{ id: "details", label: "Details" }],
      undefined,
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    await expect(
      manager.handleActionClicked(notification.id, "details", {
        appId: "com.eden.toaster",
        webContentsId: 100,
      }),
    ).resolves.toEqual({ success: true });
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "notification/action-clicked",
      {
        notificationId: notification.id,
        actionId: "details",
      },
    );
  });

  it("deletes notification state and reports removal to its source view", async () => {
    const { eventSubscribers, manager } = createManager();
    const callback = jest.fn();
    manager.registerDisplayProvider({
      appId: "com.eden.toaster",
      webContentsId: 100,
    });
    const notification = manager.pushNotification(
      "Title",
      "Message",
      0,
      "warning",
      [{ id: "force", label: "Force open" }],
      { force: callback },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(
      manager.handleDismissed(notification.id, {
        appId: "com.eden.toaster",
        webContentsId: 100,
      }),
    ).toEqual({ success: true });
    await manager.handleActionClicked(notification.id, "force", {
      appId: "com.eden.toaster",
      webContentsId: 100,
    });
    expect(callback).not.toHaveBeenCalled();
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "notification/removed",
      { id: notification.id },
    );
  });

  it("returns false for dismissed notifications it does not know about", () => {
    const { eventSubscribers, manager } = createManager();
    manager.registerDisplayProvider({
      appId: "com.eden.toaster",
      webContentsId: 100,
    });

    expect(
      manager.handleDismissed("missing", {
        appId: "com.eden.toaster",
        webContentsId: 100,
      }),
    ).toEqual({ success: false });
    expect(eventSubscribers.notifyView).not.toHaveBeenCalledWith(
      expect.any(Number),
      "notification/removed",
      expect.any(Object),
    );
  });

  it("rejects action clicks and dismissals from callers that are not the display provider", async () => {
    const { manager } = createManager();
    manager.registerDisplayProvider({
      appId: "com.eden.toaster",
      webContentsId: 100,
    });
    const notification = manager.pushNotification(
      "Title",
      "Message",
      0,
      "info",
      [{ id: "open", label: "Open" }],
    );

    await expect(
      manager.handleActionClicked(notification.id, "open", {
        appId: "com.eden.editor",
        webContentsId: 200,
      }),
    ).rejects.toThrow(/Only the notification display provider/);
    expect(() =>
      manager.handleDismissed(notification.id, {
        appId: "com.eden.editor",
        webContentsId: 200,
      }),
    ).toThrow(/Only the notification display provider/);
  });
});

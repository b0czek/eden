import "reflect-metadata";

import type { ViewBounds } from "@edenapp/types";
import type { CommandRegistry, IPCBridge } from "../ipc";
import type { NotificationManager } from "../notification";
import type { ViewManager } from "../view-manager";
import { FilePickerManager } from "./FilePickerManager";

type CommandRegistryMock = jest.Mocked<
  Pick<CommandRegistry, "registerManager">
>;
type EventSubscribersMock = {
  notify: jest.Mock;
  notifyView: jest.Mock;
  subscribeInternal: jest.Mock;
};
type ViewManagerMock = jest.Mocked<
  Pick<
    ViewManager,
    "focusView" | "getViewIdByWebContentsId" | "getViewInfo" | "showView"
  >
>;
type NotificationManagerMock = jest.Mocked<
  Pick<NotificationManager, "pushNotification">
>;
type ViewInfo = NonNullable<ReturnType<ViewManager["getViewInfo"]>>;

const openerBounds: ViewBounds = {
  x: 120,
  y: 80,
  width: 640,
  height: 420,
};

const createViewInfo = (bounds: ViewBounds, isDestroyed = false): ViewInfo =>
  ({
    bounds,
    view: {
      webContents: {
        isDestroyed: jest.fn(() => isDestroyed),
      },
    },
  }) as unknown as ViewInfo;

const createManager = () => {
  const internalSubscriptions = new Map<
    string,
    Array<(payload: never) => void>
  >();
  const eventSubscribers: EventSubscribersMock = {
    notify: jest.fn(),
    notifyView: jest.fn(),
    subscribeInternal: jest.fn(
      (event: string, callback: (payload: never) => void) => {
        internalSubscriptions.set(event, [
          ...(internalSubscriptions.get(event) ?? []),
          callback,
        ]);
      },
    ),
  };
  const ipcBridge = { eventSubscribers } as unknown as IPCBridge;
  const commandRegistry: CommandRegistryMock = {
    registerManager: jest.fn(),
  };
  const viewManager: ViewManagerMock = {
    focusView: jest.fn(),
    getViewIdByWebContentsId: jest.fn((webContentsId: number) => {
      if (webContentsId === 100) return 10;
      if (webContentsId === 200) return 20;
      if (webContentsId === 201) return 21;
      return undefined;
    }),
    getViewInfo: jest.fn((viewId: number) => {
      if (viewId === 20) {
        return createViewInfo(openerBounds);
      }
      return createViewInfo({ x: 0, y: 0, width: 0, height: 0 });
    }),
    showView: jest.fn(),
  };
  const notificationManager: NotificationManagerMock = {
    pushNotification: jest.fn(),
  };

  const manager = new FilePickerManager(
    ipcBridge,
    commandRegistry as unknown as CommandRegistry,
    viewManager as unknown as ViewManager,
    notificationManager as unknown as NotificationManager,
  );

  return {
    commandRegistry,
    eventSubscribers,
    manager,
    notificationManager,
    viewManager,
    emitInternal: (event: string, payload: never) => {
      for (const callback of internalSubscriptions.get(event) ?? []) {
        callback(payload);
      }
    },
  };
};

describe("FilePickerManager", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("opens and resolves a picker through the display provider and opener", () => {
    const { eventSubscribers, manager, viewManager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });

    const { requestId } = manager.openPicker(
      {
        mode: "open",
        selection: "file",
        filters: [{ name: "Text", extensions: ["txt", "md"] }],
      },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      10,
      "file-picker/opened",
      {
        picker: expect.objectContaining({
          requestId,
          mode: "open",
          opener: {
            appId: "com.eden.editor",
            viewId: 20,
            bounds: openerBounds,
          },
        }),
      },
    );
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "file-picker/opened",
      expect.any(Object),
    );
    expect(viewManager.showView).toHaveBeenCalledWith(10);
    expect(viewManager.focusView).toHaveBeenCalledWith(10);

    expect(
      manager.resolvePicker(
        { requestId, reason: "select", path: "/Documents/readme.md" },
        { appId: "com.eden.file-picker", webContentsId: 100 },
      ),
    ).toEqual({ success: true });
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      10,
      "file-picker/closed",
      { requestId, reason: "select", path: "/Documents/readme.md" },
    );
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "file-picker/closed",
      { requestId, reason: "select", path: "/Documents/readme.md" },
    );
  });

  it("rejects a second request while a picker is active and pushes a toast", () => {
    const { manager, notificationManager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    manager.openPicker(
      { mode: "open" },
      {
        appId: "com.eden.editor",
        webContentsId: 200,
      },
    );

    expect(() =>
      manager.openPicker(
        { mode: "save", suggestedName: "report.md" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).toThrow(/File picker is busy/);
    expect(notificationManager.pushNotification).toHaveBeenCalledWith(
      "File picker is busy",
      "Resolve the current file picker before opening another.",
      5000,
      "warning",
    );
  });

  it("allows the display provider to close the active picker", () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(
      manager.closePicker(requestId, {
        appId: "com.eden.file-picker",
        webContentsId: 100,
      }),
    ).toEqual({ success: true });

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "file-picker/closed",
      { requestId, reason: "close" },
    );
    expect(() =>
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).not.toThrow();
  });

  it("clears orphaned active requests when the display provider re-registers", () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "file-picker/closed",
      { requestId, reason: "close" },
    );
    expect(() =>
      manager.openPicker(
        { mode: "save", suggestedName: "report.md" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).not.toThrow();
  });

  it("prunes orphaned active requests when the display provider view is gone", () => {
    const { manager, notificationManager, viewManager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    viewManager.getViewInfo.mockImplementation((viewId: number) => {
      if (viewId === 10) return undefined;
      if (viewId === 20) return createViewInfo(openerBounds);
      return createViewInfo({ x: 0, y: 0, width: 0, height: 0 });
    });

    expect(() =>
      manager.openPicker(
        { mode: "save", suggestedName: "report.md" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).toThrow(/display provider is not registered/);
    expect(notificationManager.pushNotification).not.toHaveBeenCalled();
  });

  it("closes the active picker when the opener app stops", () => {
    const { emitInternal, eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    emitInternal("process/stopped", { appId: "com.eden.editor" } as never);

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      10,
      "file-picker/closed",
      { requestId, reason: "close" },
    );
    expect(() =>
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).not.toThrow();
  });

  it("clears the display provider when the picker app stops", () => {
    const { emitInternal, eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    emitInternal("process/stopped", {
      appId: "com.eden.file-picker",
    } as never);

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "file-picker/closed",
      { requestId, reason: "close" },
    );
    expect(() =>
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).toThrow(/display provider is not registered/);
  });

  it("allows a new picker after the display provider cancels the active request", () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const first = manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(
      manager.resolvePicker(
        { requestId: first.requestId, reason: "cancel" },
        { appId: "com.eden.file-picker", webContentsId: 100 },
      ),
    ).toEqual({ success: true });

    const second = manager.openPicker(
      { mode: "save", suggestedName: "report.md" },
      { appId: "com.eden.notes", webContentsId: 201 },
    );

    expect(second.requestId).not.toBe(first.requestId);
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "file-picker/closed",
      { requestId: first.requestId, reason: "cancel" },
    );
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      21,
      "file-picker/opened",
      expect.objectContaining({
        picker: expect.objectContaining({ requestId: second.requestId }),
      }),
    );
  });
});

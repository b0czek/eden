import "reflect-metadata";

import type { CommandRegistry, IPCBridge } from "../ipc";
import type { ViewManager } from "../view-manager";
import { ContextMenuManager } from "./ContextMenuManager";

type EventSubscribersMock = {
  notify: jest.Mock;
  notifyView: jest.Mock;
};
type ViewManagerMock = jest.Mocked<
  Pick<
    ViewManager,
    "getViewIdByWebContentsId" | "getViewInfo" | "getWindowSize"
  >
>;

const createManager = () => {
  const eventSubscribers: EventSubscribersMock = {
    notify: jest.fn(),
    notifyView: jest.fn(),
  };
  const ipcBridge = { eventSubscribers } as unknown as IPCBridge;
  const commandRegistry = {
    registerManager: jest.fn(),
  } as unknown as jest.Mocked<Pick<CommandRegistry, "registerManager">>;
  const getZoomFactor = jest.fn(() => 1);
  const viewManager: ViewManagerMock = {
    getViewIdByWebContentsId: jest.fn((webContentsId: number) => {
      if (webContentsId === 100) return 10;
      if (webContentsId === 200) return 20;
      if (webContentsId === 201) return 21;
      return undefined;
    }),
    getViewInfo: jest.fn(
      (viewId: number) =>
        ({
          bounds:
            viewId === 20
              ? { x: 10, y: 20, width: 300, height: 200 }
              : { x: 0, y: 0, width: 0, height: 0 },
          view: {
            webContents: {
              getZoomFactor,
              isDestroyed: jest.fn(() => false),
            },
          },
        }) as never,
    ),
    getWindowSize: jest.fn(() => ({ width: 1024, height: 768 })),
  };

  const manager = new ContextMenuManager(
    ipcBridge,
    commandRegistry as unknown as CommandRegistry,
    viewManager as unknown as ViewManager,
  );

  return {
    commandRegistry,
    eventSubscribers,
    getZoomFactor,
    manager,
    viewManager,
  };
};

describe("ContextMenuManager", () => {
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

  it("registers a display provider and opens a menu for provider and opener", () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.context-menu",
      webContentsId: 100,
    });
    const result = manager.openMenu(
      {
        position: { left: 5, top: 6 },
        items: [{ type: "item", id: "open", label: "Open" }],
      },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(result.requestId).toEqual(expect.any(String));
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      10,
      "context-menu/opened",
      {
        menu: expect.objectContaining({
          requestId: result.requestId,
          position: { left: 15, top: 26 },
        }),
      },
    );
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "context-menu/opened",
      expect.any(Object),
    );
  });

  it("scales renderer coordinates by the opener view zoom factor", () => {
    const { eventSubscribers, getZoomFactor, manager } = createManager();
    getZoomFactor.mockReturnValue(1.5);

    manager.registerDisplayProvider({
      appId: "com.eden.context-menu",
      webContentsId: 100,
    });
    manager.openMenu(
      {
        position: { left: 40, top: 60, right: 8, bottom: 12 },
        items: [],
      },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      10,
      "context-menu/opened",
      {
        menu: expect.objectContaining({
          position: {
            left: 70,
            top: 110,
            right: 726,
            bottom: 566,
          },
        }),
      },
    );
  });

  it("prevents the display provider from opening context menus", () => {
    const { manager } = createManager();
    manager.registerDisplayProvider({
      appId: "com.eden.context-menu",
      webContentsId: 100,
    });

    expect(() =>
      manager.openMenu(
        { position: { left: 0, top: 0 }, items: [] },
        { appId: "com.eden.context-menu", webContentsId: 100 },
      ),
    ).toThrow(/Display provider cannot open context menus/);
  });

  it("allows only the opener to close a context menu", () => {
    const { manager } = createManager();
    manager.registerDisplayProvider({
      appId: "com.eden.context-menu",
      webContentsId: 100,
    });
    const { requestId } = manager.openMenu(
      { position: { left: 0, top: 0 }, items: [] },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(() =>
      manager.closeMenu(requestId, {
        appId: "com.eden.notes",
        webContentsId: 201,
      }),
    ).toThrow(/Only the original opener can close this menu/);

    expect(
      manager.closeMenu(requestId, {
        appId: "com.eden.editor",
        webContentsId: 200,
      }),
    ).toEqual({ success: true });
  });
});

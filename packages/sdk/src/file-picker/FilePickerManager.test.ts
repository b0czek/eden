import "reflect-metadata";

import type {
  NotificationAction,
  RuntimeAppManifest,
  ViewBounds,
} from "@edenapp/types";
import type { AppAssociationManager } from "../app-associations";
import type { CommandRegistry, IPCBridge, PermissionRegistry } from "../ipc";
import type { NotificationManager } from "../notification";
import type { ProcessManager } from "../process-manager";
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
type ProcessManagerMock = jest.Mocked<
  Pick<ProcessManager, "ensureAppRunning" | "getAppInstance" | "stopApp">
>;
type AppAssociationManagerMock = jest.Mocked<
  Pick<AppAssociationManager, "resolve">
>;
type PermissionRegistryMock = jest.Mocked<
  Pick<PermissionRegistry, "hasPermission">
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

const providerManifest = (
  id: string,
  permissions = ["file-picker/display"],
): RuntimeAppManifest =>
  ({
    id,
    name: id,
    version: "1.0.0",
    frontend: { entry: "dist/index.html" },
    permissions,
    isPrebuilt: false,
    isCore: false,
    isRestricted: false,
    resolvedGrants: [],
  }) as RuntimeAppManifest;

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
  const processManager: ProcessManagerMock = {
    ensureAppRunning: jest.fn(
      async (_appId: string) =>
        ({}) as Awaited<ReturnType<ProcessManager["ensureAppRunning"]>>,
    ),
    getAppInstance: jest.fn((_appId: string) => ({}) as never),
    stopApp: jest.fn(async (_appId: string) => undefined),
  };
  const appAssociationManager: AppAssociationManagerMock = {
    resolve: jest.fn((_key, _matches) => [
      { appId: "com.eden.file-picker", kind: "provider" },
    ]),
  };
  const permissionRegistry: PermissionRegistryMock = {
    hasPermission: jest.fn(
      (_appId: string, permission: string) =>
        permission === "file-picker/display",
    ),
  };

  const manager = new FilePickerManager(
    ipcBridge,
    commandRegistry as unknown as CommandRegistry,
    viewManager as unknown as ViewManager,
    notificationManager as unknown as NotificationManager,
    processManager as unknown as ProcessManager,
    appAssociationManager as unknown as AppAssociationManager,
    permissionRegistry as unknown as PermissionRegistry,
  );

  return {
    appAssociationManager,
    commandRegistry,
    eventSubscribers,
    manager,
    notificationManager,
    processManager,
    permissionRegistry,
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

  it("opens and resolves a picker through the display provider and opener", async () => {
    const { eventSubscribers, manager, viewManager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });

    const { requestId } = await manager.openPicker(
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

  it("starts and waits for the display provider when none is registered", async () => {
    const { appAssociationManager, manager, processManager, viewManager } =
      createManager();
    appAssociationManager.resolve.mockReturnValue([
      { appId: "com.example.file-picker", kind: "provider" },
    ]);

    const opened = manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );
    await Promise.resolve();

    expect(processManager.ensureAppRunning).toHaveBeenCalledWith(
      "com.example.file-picker",
    );
    expect(appAssociationManager.resolve).toHaveBeenCalledWith(
      "provider:file-picker",
      expect.any(Function),
    );

    manager.registerDisplayProvider({
      appId: "com.example.file-picker",
      webContentsId: 100,
    });

    await expect(opened).resolves.toEqual(
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect(viewManager.showView).toHaveBeenCalledWith(10);
    expect(viewManager.focusView).toHaveBeenCalledWith(10);
  });

  it("rejects opening when no permitted file picker provider is available", async () => {
    const { appAssociationManager, manager, processManager } = createManager();
    appAssociationManager.resolve.mockReturnValue([]);

    await expect(
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.editor", webContentsId: 200 },
      ),
    ).rejects.toThrow(
      "No file picker display provider is installed or permitted",
    );
    expect(processManager.ensureAppRunning).not.toHaveBeenCalled();
  });

  it("uses the exact display permission as the provider predicate", async () => {
    const { appAssociationManager, manager, permissionRegistry } =
      createManager();
    appAssociationManager.resolve.mockReturnValue([]);
    await expect(
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.editor", webContentsId: 200 },
      ),
    ).rejects.toThrow();

    const matches = appAssociationManager.resolve.mock.calls[0]?.[1];
    expect(matches?.(providerManifest("provider"))).toBe(true);
    expect(permissionRegistry.hasPermission).toHaveBeenCalledWith(
      "provider",
      "file-picker/display",
    );
  });

  it("rejects ambiguous file picker providers", async () => {
    const { appAssociationManager, manager, processManager } = createManager();
    appAssociationManager.resolve.mockReturnValue([
      { appId: "com.example.first-picker", kind: "provider" },
      { appId: "com.example.second-picker", kind: "provider" },
    ]);

    await expect(
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.editor", webContentsId: 200 },
      ),
    ).rejects.toThrow(
      "Multiple file picker display providers are available: com.example.first-picker, com.example.second-picker",
    );
    expect(processManager.ensureAppRunning).not.toHaveBeenCalled();
  });

  it("rejects a second request while a picker is active and pushes a toast", async () => {
    const { manager, notificationManager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    await manager.openPicker(
      { mode: "open" },
      {
        appId: "com.eden.editor",
        webContentsId: 200,
      },
    );

    await expect(
      manager.openPicker(
        { mode: "save", suggestedName: "report.md" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).rejects.toThrow(/File picker is busy/);
    expect(notificationManager.pushNotification).toHaveBeenCalledWith(
      "File picker is busy",
      "Resolve the current file picker before opening another.",
      0,
      "warning",
      [
        expect.objectContaining({
          id: "force-open-file-picker",
          label: "Force open",
        }),
      ],
      expect.objectContaining({
        "force-open-file-picker": expect.any(Function),
      }),
    );
  });

  it("force opens the blocked request from a busy toast action", async () => {
    const { eventSubscribers, manager, notificationManager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const first = await manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    await expect(
      manager.openPicker(
        { mode: "save", suggestedName: "report.md" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).rejects.toThrow(/File picker is busy/);

    const actions = notificationManager.pushNotification.mock.calls[0]?.[4] as
      | NotificationAction[]
      | undefined;
    expect(actions?.[0]).toEqual({
      id: "force-open-file-picker",
      label: "Force open",
    });
    const callbacks = notificationManager.pushNotification.mock.calls[0]?.[5];
    const callback = callbacks?.["force-open-file-picker"];
    if (!callback) throw new Error("Expected force-open callback");

    await callback({} as never);

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      20,
      "file-picker/closed",
      { requestId: first.requestId, reason: "close" },
    );
    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      21,
      "file-picker/opened",
      expect.objectContaining({
        picker: expect.objectContaining({
          mode: "save",
          suggestedName: "report.md",
          opener: expect.objectContaining({
            appId: "com.eden.notes",
            viewId: 21,
          }),
        }),
      }),
    );
  });

  it("allows the display provider to close the active picker", async () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = await manager.openPicker(
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
    await expect(
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("clears orphaned active requests when the display provider re-registers", async () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = await manager.openPicker(
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
    await expect(
      manager.openPicker(
        { mode: "save", suggestedName: "report.md" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("prunes orphaned active requests when the display provider view is gone", async () => {
    const { manager, notificationManager, viewManager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    await manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    viewManager.getViewInfo.mockImplementation((viewId: number) => {
      if (viewId === 10) return undefined;
      if (viewId === 20) return createViewInfo(openerBounds);
      return createViewInfo({ x: 0, y: 0, width: 0, height: 0 });
    });

    const opened = manager.openPicker(
      { mode: "save", suggestedName: "report.md" },
      { appId: "com.eden.notes", webContentsId: 201 },
    );
    await Promise.resolve();

    viewManager.getViewInfo.mockImplementation((viewId: number) => {
      if (viewId === 20) return createViewInfo(openerBounds);
      return createViewInfo({ x: 0, y: 0, width: 0, height: 0 });
    });
    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });

    await expect(opened).resolves.toEqual(
      expect.objectContaining({ requestId: expect.any(String) }),
    );
    expect(notificationManager.pushNotification).not.toHaveBeenCalled();
  });

  it("closes the active picker when the opener app stops", async () => {
    const { emitInternal, eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = await manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    emitInternal("process/stopped", { appId: "com.eden.editor" } as never);

    expect(eventSubscribers.notifyView).toHaveBeenCalledWith(
      10,
      "file-picker/closed",
      { requestId, reason: "close" },
    );
    await expect(
      manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.notes", webContentsId: 201 },
      ),
    ).resolves.toEqual(
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("clears the display provider when the picker app stops", async () => {
    const { emitInternal, eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const { requestId } = await manager.openPicker(
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
    const opened = manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.notes", webContentsId: 201 },
    );
    await Promise.resolve();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });

    await expect(opened).resolves.toEqual(
      expect.objectContaining({ requestId: expect.any(String) }),
    );
  });

  it("allows a new picker after the display provider cancels the active request", async () => {
    const { eventSubscribers, manager } = createManager();

    manager.registerDisplayProvider({
      appId: "com.eden.file-picker",
      webContentsId: 100,
    });
    const first = await manager.openPicker(
      { mode: "open" },
      { appId: "com.eden.editor", webContentsId: 200 },
    );

    expect(
      manager.resolvePicker(
        { requestId: first.requestId, reason: "cancel" },
        { appId: "com.eden.file-picker", webContentsId: 100 },
      ),
    ).toEqual({ success: true });

    const second = await manager.openPicker(
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

  it("stops the provider after ten seconds idle", async () => {
    jest.useFakeTimers();
    try {
      const { manager, processManager } = createManager();

      manager.registerDisplayProvider({
        appId: "com.eden.file-picker",
        webContentsId: 100,
      });
      const { requestId } = await manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.editor", webContentsId: 200 },
      );

      manager.resolvePicker(
        { requestId, reason: "cancel" },
        { appId: "com.eden.file-picker", webContentsId: 100 },
      );

      jest.advanceTimersByTime(9999);
      expect(processManager.stopApp).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await Promise.resolve();
      expect(processManager.stopApp).toHaveBeenCalledWith(
        "com.eden.file-picker",
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it("cancels pending idle shutdown when a new picker opens", async () => {
    jest.useFakeTimers();
    try {
      const { manager, processManager } = createManager();

      manager.registerDisplayProvider({
        appId: "com.eden.file-picker",
        webContentsId: 100,
      });
      const first = await manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.editor", webContentsId: 200 },
      );
      manager.resolvePicker(
        { requestId: first.requestId, reason: "cancel" },
        { appId: "com.eden.file-picker", webContentsId: 100 },
      );

      jest.advanceTimersByTime(5000);
      await manager.openPicker(
        { mode: "save", suggestedName: "report.md" },
        { appId: "com.eden.notes", webContentsId: 201 },
      );
      jest.advanceTimersByTime(5000);

      expect(processManager.stopApp).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not stop a stopped provider from a pending idle shutdown", async () => {
    jest.useFakeTimers();
    try {
      const { emitInternal, manager, processManager } = createManager();

      manager.registerDisplayProvider({
        appId: "com.eden.file-picker",
        webContentsId: 100,
      });
      const { requestId } = await manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.editor", webContentsId: 200 },
      );
      manager.resolvePicker(
        { requestId, reason: "cancel" },
        { appId: "com.eden.file-picker", webContentsId: 100 },
      );

      emitInternal("process/stopped", {
        appId: "com.eden.file-picker",
      } as never);
      jest.advanceTimersByTime(10_000);

      expect(processManager.stopApp).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not stop the old provider later after provider replacement", async () => {
    jest.useFakeTimers();
    try {
      const { manager, processManager } = createManager();

      manager.registerDisplayProvider({
        appId: "com.example.old-picker",
        webContentsId: 100,
      });
      const { requestId } = await manager.openPicker(
        { mode: "open" },
        { appId: "com.eden.editor", webContentsId: 200 },
      );
      manager.resolvePicker(
        { requestId, reason: "cancel" },
        { appId: "com.example.old-picker", webContentsId: 100 },
      );

      manager.registerDisplayProvider({
        appId: "com.example.new-picker",
        webContentsId: 100,
      });

      jest.advanceTimersByTime(10_000);

      expect(processManager.stopApp).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

import "reflect-metadata";

import type { AppManifest, EdenConfig, TilingConfig } from "@edenapp/types";
import type { CommandRegistry, IPCBridge } from "../ipc";
import type {
  Bounds,
  DisplayPort,
  PlatformWindow,
  WindowingPort,
} from "../platform/ports";
import type { SettingsManager } from "../settings/SettingsManager";
import type { ViewInfo, ViewMode } from "./types";
import { ViewManager } from "./ViewManager";

const HIDDEN_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 };

interface ViewManagerInternals {
  views: Map<number, ViewInfo>;
}

function createManager(tiling: TilingConfig): ViewManager {
  const commandRegistry = {
    registerManager: jest.fn(),
  } as unknown as CommandRegistry;
  const ipcBridge = {
    eventSubscribers: {
      notify: jest.fn(),
      notifyView: jest.fn(),
    },
  } as unknown as IPCBridge;
  const settingsManager = {
    on: jest.fn(() => jest.fn()),
    get: jest.fn().mockResolvedValue(undefined),
  } as unknown as SettingsManager;

  const manager = new ViewManager(
    commandRegistry,
    ipcBridge,
    { tiling } as EdenConfig,
    "/tmp",
    settingsManager,
    {
      createView: jest.fn(),
      createWindow: jest.fn(),
      attachWebContentsLogger: jest.fn(),
      getWebContentsById: jest.fn(),
    } as unknown as WindowingPort,
    {
      getCursorScreenPoint: jest.fn(() => ({ x: 0, y: 0 })),
      getDisplayMatching: jest.fn(),
    } as unknown as DisplayPort,
  );
  manager.setMainWindow({
    isDestroyed: () => false,
    contentView: {
      addChildView: jest.fn(),
      removeChildView: jest.fn(),
    },
  } as unknown as PlatformWindow);

  return manager;
}

function addView(
  manager: ViewManager,
  mode: ViewMode,
  bounds: Bounds,
  options: {
    viewType?: ViewInfo["viewType"];
    scaling?: "auto" | "manual";
  } = {},
): { info: ViewInfo; setBounds: jest.Mock } {
  const setBounds = jest.fn();
  const info: ViewInfo = {
    id: 1,
    view: {
      setBounds,
      webContents: {
        isDestroyed: () => false,
        setZoomFactor: jest.fn(),
      },
    } as unknown as ViewInfo["view"],
    appId: "com.example.app",
    manifest: {
      id: "com.example.app",
      name: "Example",
      version: "1.0.0",
      window: { mode, scaling: options.scaling },
    } as AppManifest,
    bounds,
    requestedVisible: true,
    visible: true,
    mode,
    viewType: options.viewType ?? "app",
    tileIndex: mode === "tiled" ? 0 : undefined,
    zIndex: mode === "floating" ? 1 : undefined,
  };

  (manager as unknown as ViewManagerInternals).views.set(info.id, info);
  return { info, setBounds };
}

describe("ViewManager visibility", () => {
  it("preserves a floating app's logical size when interface scale changes", () => {
    const manager = createManager({ mode: "none", gap: 0, padding: 0 });
    const { info, setBounds } = addView(manager, "floating", {
      x: 120,
      y: 80,
      width: 600,
      height: 400,
    });

    manager.setInterfaceScale(1.5);

    expect(info.bounds).toEqual({ x: 120, y: 80, width: 900, height: 600 });
    expect(setBounds).toHaveBeenLastCalledWith(info.bounds);
  });

  it("resizes an explicitly auto-scaled overlay when interface scale changes", () => {
    const manager = createManager({ mode: "none", gap: 0, padding: 0 });
    const { info, setBounds } = addView(
      manager,
      "floating",
      { x: 120, y: 80, width: 600, height: 400 },
      { viewType: "overlay", scaling: "auto" },
    );

    manager.setInterfaceScale(1.5);

    expect(info.bounds).toEqual({ x: 120, y: 80, width: 900, height: 600 });
    expect(setBounds).toHaveBeenLastCalledWith(info.bounds);
  });

  it("restores oversized floating bounds after a scale round trip", () => {
    const manager = createManager({ mode: "none", gap: 0, padding: 0 });
    const { info } = addView(manager, "floating", {
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
    });

    manager.setInterfaceScale(2);
    expect(info.bounds).toMatchObject({ width: 2000, height: 1600 });

    manager.setInterfaceScale(1);
    expect(info.bounds).toMatchObject({ width: 1000, height: 800 });
  });

  it("restores a floating view to its bounds after hiding it", () => {
    const manager = createManager({ mode: "none", gap: 0, padding: 0 });
    const originalBounds = { x: 120, y: 80, width: 640, height: 480 };
    const { info, setBounds } = addView(manager, "floating", originalBounds);

    manager.hideView(info.id);

    expect(setBounds).toHaveBeenLastCalledWith(HIDDEN_BOUNDS);
    expect(info.bounds).toEqual(originalBounds);
    expect(info.requestedVisible).toBe(false);
    expect(info.visible).toBe(false);

    manager.showView(info.id);

    expect(setBounds).toHaveBeenLastCalledWith(originalBounds);
    expect(info.bounds).toEqual(originalBounds);
    expect(info.requestedVisible).toBe(true);
    expect(info.visible).toBe(true);
  });

  it("recalculates tiled bounds after hiding and showing a view", () => {
    const manager = createManager({
      mode: "grid",
      rows: 1,
      columns: 1,
      gap: 0,
      padding: 0,
    });
    const { info, setBounds } = addView(manager, "tiled", {
      x: 20,
      y: 20,
      width: 400,
      height: 300,
    });

    manager.hideView(info.id);
    expect(setBounds).toHaveBeenLastCalledWith(HIDDEN_BOUNDS);

    manager.showView(info.id);

    const workspaceBounds = { x: 0, y: 0, width: 800, height: 600 };
    expect(setBounds).toHaveBeenLastCalledWith(workspaceBounds);
    expect(info.bounds).toEqual(workspaceBounds);
    expect(info.requestedVisible).toBe(true);
    expect(info.visible).toBe(true);
  });
});

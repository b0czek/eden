import type { AppManifest, EdenConfig, TilingConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEffectRuntime } from "../effects/runtime";
import { createEvent } from "../events/event";
import type { Bounds, PlatformWindow, WindowingPort } from "../platform/ports";
import { createViews, type Views } from "./service";
import type { ViewInfo, ViewMode } from "./types";

const HIDDEN_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function createViewsFixture(tiling: TilingConfig): Promise<Views> {
  const effects = createEffectRuntime();
  cleanups.unshift(() => effects.dispose());
  const views = await effects.acquire(
    createViews({
      config: { tiling } as EdenConfig,
      distPath: "/tmp",
      settings: {
        get: () => Effect.succeed(undefined),
        changed: createEvent(),
      },
      windows: {
        createView: () => ({
          setBounds: jest.fn(),
          getBounds: () => HIDDEN_BOUNDS,
          webContents: {
            id: 1,
            isDestroyed: () => false,
            setZoomFactor: jest.fn(),
            on: jest.fn(),
            loadFile: jest.fn(),
            isDevToolsOpened: () => false,
            close: jest.fn(),
          },
        }),
        createWindow: jest.fn(),
        attachWebContentsLogger: jest.fn(),
        getWebContentsById: jest.fn(),
      } as unknown as WindowingPort,
    }),
  );
  views.setMainWindow({
    isDestroyed: () => false,
    contentView: { addChildView: jest.fn(), removeChildView: jest.fn() },
  } as unknown as PlatformWindow);
  return views;
}
function addView(
  views: Views,
  mode: ViewMode,
  bounds: Bounds,
  options: {
    viewType?: ViewInfo["viewType"];
    scaling?: "auto" | "manual";
  } = {},
): { info: ViewInfo; setBounds: jest.Mock } {
  const manifest = {
    id: "com.example.app",
    name: "Example",
    version: "1.0.0",
    frontend: { entry: "index.html" },
    overlay: options.viewType === "overlay",
    window: { mode, scaling: options.scaling },
  } as AppManifest;
  const id = views.createView(manifest.id, manifest, "/apps/example", bounds);
  const info = views.getViewInfo(id)!;
  return { info, setBounds: info.view.setBounds as jest.Mock };
}

describe("Views visibility", () => {
  it("preserves a floating app's logical size when interface scale changes", async () => {
    const views = await createViewsFixture({
      mode: "none",
      gap: 0,
      padding: 0,
    });
    const { info, setBounds } = addView(views, "floating", {
      x: 120,
      y: 80,
      width: 600,
      height: 400,
    });

    views.setInterfaceScale(1.5);

    expect(info.bounds).toEqual({ x: 120, y: 80, width: 900, height: 600 });
    expect(setBounds).toHaveBeenLastCalledWith(info.bounds);
  });

  it("resizes an explicitly auto-scaled overlay when interface scale changes", async () => {
    const views = await createViewsFixture({
      mode: "none",
      gap: 0,
      padding: 0,
    });
    const { info, setBounds } = addView(
      views,
      "floating",
      { x: 120, y: 80, width: 600, height: 400 },
      { viewType: "overlay", scaling: "auto" },
    );

    views.setInterfaceScale(1.5);

    expect(info.bounds).toEqual({ x: 120, y: 80, width: 900, height: 600 });
    expect(setBounds).toHaveBeenLastCalledWith(info.bounds);
  });

  it("restores oversized floating bounds after a scale round trip", async () => {
    const views = await createViewsFixture({
      mode: "none",
      gap: 0,
      padding: 0,
    });
    const { info } = addView(views, "floating", {
      x: 0,
      y: 0,
      width: 1000,
      height: 800,
    });

    views.setInterfaceScale(2);
    expect(info.bounds).toMatchObject({ width: 2000, height: 1600 });

    views.setInterfaceScale(1);
    expect(info.bounds).toMatchObject({ width: 1000, height: 800 });
  });

  it("restores a floating view to its bounds after hiding it", async () => {
    const views = await createViewsFixture({
      mode: "none",
      gap: 0,
      padding: 0,
    });
    const originalBounds = { x: 120, y: 80, width: 640, height: 480 };
    const { info, setBounds } = addView(views, "floating", originalBounds);

    views.hideView(info.id);

    expect(setBounds).toHaveBeenLastCalledWith(HIDDEN_BOUNDS);
    expect(info.bounds).toEqual(originalBounds);
    expect(info.requestedVisible).toBe(false);
    expect(info.visible).toBe(false);

    views.showView(info.id);

    expect(setBounds).toHaveBeenLastCalledWith(originalBounds);
    expect(info.bounds).toEqual(originalBounds);
    expect(info.requestedVisible).toBe(true);
    expect(info.visible).toBe(true);
  });

  it("recalculates tiled bounds after hiding and showing a view", async () => {
    const views = await createViewsFixture({
      mode: "grid",
      rows: 1,
      columns: 1,
      gap: 0,
      padding: 0,
    });
    const { info, setBounds } = addView(views, "tiled", {
      x: 20,
      y: 20,
      width: 400,
      height: 300,
    });

    views.hideView(info.id);
    expect(setBounds).toHaveBeenLastCalledWith(HIDDEN_BOUNDS);

    views.showView(info.id);

    const workspaceBounds = { x: 0, y: 0, width: 800, height: 600 };
    expect(setBounds).toHaveBeenLastCalledWith(workspaceBounds);
    expect(info.bounds).toEqual(workspaceBounds);
    expect(info.requestedVisible).toBe(true);
    expect(info.visible).toBe(true);
  });
});

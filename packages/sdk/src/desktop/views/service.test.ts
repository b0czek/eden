import assert from "node:assert/strict";
import type { AppManifest, EdenConfig, TilingConfig } from "@edenapp/types";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { testApp } from "../../../tests/support/apps";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import { InMemoryPlatform } from "../../../tests/support/in-memory-platform";
import { createEvent } from "../../core/events/event";
import { Settings } from "../../core/settings/service";
import {
  type Bounds,
  type PlatformWindow,
  WindowingPort,
} from "../../platform/ports/types";
import { DistPath, RuntimeConfig } from "../../runtime/inputs";
import {
  TileActionUnavailable,
  ViewModeUnsupported,
  ViewNativeFailure,
  ViewUnavailable,
} from "./errors";
import { Views, ViewsLive } from "./service";
import type { ViewInfo, ViewMode } from "./types";

const unexpectedSettingsUse = (): never => {
  throw new Error("Unexpected Settings dependency");
};
const settingsChecks = {
  canRead: unexpectedSettingsUse,
  assertReadableBy: unexpectedSettingsUse,
  resolveGrantKey: unexpectedSettingsUse,
  assertAccess: unexpectedSettingsUse,
  filterAllowedKeys: unexpectedSettingsUse,
  filterSchemaByGrants: unexpectedSettingsUse,
};

const HIDDEN_BOUNDS: Bounds = { x: 0, y: 0, width: 0, height: 0 };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function createViewsFixture(tiling: TilingConfig): Promise<Views> {
  const effects = createEffectRuntime();
  cleanups.unshift(() => effects.dispose());
  const views = await effects.acquire(
    buildService(Views, ViewsLive).pipe(
      Effect.provideService(RuntimeConfig, { tiling } as EdenConfig),
      Effect.provideService(DistPath, "/tmp"),
      Effect.provide(
        Layer.mock(Settings, {
          ...settingsChecks,
          get: () => Effect.succeed(undefined),
          changed: createEvent<{ appId: string; key: string; value: string }>(),
        }),
      ),
      Effect.provideService(WindowingPort, {
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
      } as unknown as WindowingPort),
    ),
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
  const id = Effect.runSync(
    views.createView(manifest.id, manifest, "/apps/example", bounds),
  );
  const info = views.getViewInfo(id);
  assert(info, "Created view is missing");
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

    Effect.runSync(views.hideView(info.id));

    expect(setBounds).toHaveBeenLastCalledWith(HIDDEN_BOUNDS);
    expect(info.bounds).toEqual(originalBounds);
    expect(info.requestedVisible).toBe(false);
    expect(info.visible).toBe(false);

    Effect.runSync(views.showView(info.id));

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

    Effect.runSync(views.hideView(info.id));
    expect(setBounds).toHaveBeenLastCalledWith(HIDDEN_BOUNDS);

    Effect.runSync(views.showView(info.id));

    const workspaceBounds = { x: 0, y: 0, width: 800, height: 600 };
    expect(setBounds).toHaveBeenLastCalledWith(workspaceBounds);
    expect(info.bounds).toEqual(workspaceBounds);
    expect(info.requestedVisible).toBe(true);
    expect(info.visible).toBe(true);
  });
});

describe("web contents lookup lifecycle", () => {
  let effects: ReturnType<typeof createEffectRuntime>;
  let platform: InMemoryPlatform;
  let views: Views;

  beforeEach(async () => {
    effects = createEffectRuntime();
    cleanups.unshift(() => effects.dispose());
    platform = new InMemoryPlatform("/tmp");
    views = await effects.acquire(
      buildService(Views, ViewsLive).pipe(
        Effect.provideService(RuntimeConfig, {
          tiling: { mode: "none", gap: 0, padding: 0 },
        }),
        Effect.provideService(DistPath, "/tmp"),
        Effect.provide(
          Layer.mock(Settings, {
            ...settingsChecks,
            get: () => Effect.succeed(undefined),
            changed: createEvent<{
              appId: string;
              key: string;
              value: string;
            }>(),
          }),
        ),
        Effect.provideService(WindowingPort, platform.windows),
      ),
    );
    views.setMainWindow(platform.windows.createWindow({}));
  });

  afterEach(() => jest.restoreAllMocks());

  function create(appId: string) {
    const manifest = testApp(appId, {
      window: {
        mode: "floating",
        injections: { css: "none", appFrame: false },
      },
    });
    const viewId = Effect.runSync(
      views.createView(appId, manifest, "/apps/example", undefined),
    );
    const info = views.getViewInfo(viewId);
    assert(info, "Created view is missing");
    return { viewId, contents: info.view.webContents };
  }

  it("defers native view creation and removal until their Effects execute", async () => {
    const manifest = testApp("app.lazy");
    const creation = views.createView(
      manifest.id,
      manifest,
      "/apps/example",
      undefined,
    );
    expect(views.getAllViews()).toEqual([]);
    expect(platform.windows.views).toHaveLength(0);
    const id = await effects.run(creation);
    const view = views.getView(id);
    assert(view, "Created native view is missing");
    const contents = view.webContents;
    const removal = views.removeView(id);
    expect(contents.isDestroyed()).toBe(false);
    expect(views.getView(id)).toBeDefined();
    await effects.run(removal);
    expect(contents.isDestroyed()).toBe(true);
    expect(views.getView(id)).toBeUndefined();
  });

  it("rejects missing or destroyed renderers without changing surviving views", () => {
    const surviving = create("app.surviving");
    expect(() => views.getTileLayoutState(-1)).toThrow(ViewUnavailable);
    expect(() => Effect.runSync(views.showView(-1))).toThrow(ViewUnavailable);
    expect(() => Effect.runSync(views.showView(-1))).toThrow(
      expect.objectContaining({ viewId: -1, reason: "missing" }),
    );
    const destroyed = create("app.destroyed");
    destroyed.contents.close();
    expect(() =>
      Effect.runSync(views.setViewBounds(destroyed.viewId, HIDDEN_BOUNDS)),
    ).toThrow(
      expect.objectContaining({
        _tag: "ViewUnavailable",
        viewId: destroyed.viewId,
        reason: "destroyed",
        appId: "app.destroyed",
      }),
    );
    expect(views.getView(surviving.viewId)?.webContents.isDestroyed()).toBe(
      false,
    );
  });

  it("rejects unsupported modes and unavailable tile actions before changing presentation", () => {
    const view = create("app.floating");
    const info = views.getViewInfo(view.viewId);
    assert(info, "Created view is missing");
    const before = { ...info.bounds };
    expect(() =>
      Effect.runSync(views.setViewMode(view.viewId, "tiled")),
    ).toThrow(ViewModeUnsupported);
    expect(views.getViewInfo(view.viewId)).toMatchObject({
      mode: "floating",
      bounds: before,
    });
    expect(() =>
      Effect.runSync(views.swapTiledView(view.viewId, "left")),
    ).toThrow(TileActionUnavailable);
    expect(() =>
      Effect.runSync(views.expandTiledView(view.viewId, "right")),
    ).toThrow(
      expect.objectContaining({
        _tag: "TileActionUnavailable",
        viewId: view.viewId,
        action: "expand",
        direction: "right",
      }),
    );
  });

  it("retains native bounds failures with view context and does not publish success", () => {
    const view = create("app.bounds");
    const cause = new Error("Native bounds rejected");
    const updates: unknown[] = [];
    views.boundsUpdated.on((event) => {
      updates.push(event);
    });
    const nativeView = views.getView(view.viewId);
    assert(nativeView, "Created native view is missing");
    jest.spyOn(nativeView, "setBounds").mockImplementationOnce(() => {
      throw cause;
    });
    const exit = Effect.runSyncExit(
      views.setViewBounds(
        view.viewId,
        { x: 10, y: 20, width: 500, height: 300 },
        { notify: true },
      ),
    );
    assert(Exit.isFailure(exit));
    expect(Cause.hasDies(exit.cause)).toBe(false);
    expect(Cause.squash(exit.cause)).toMatchObject({
      _tag: "ViewNativeFailure",
      operation: "set-bounds",
      viewId: view.viewId,
      appId: "app.bounds",
      cause,
    });
    expect(updates).toEqual([]);
  });

  it("preserves defects in layout calculations without converting them to native failures", () => {
    const view = create("app.layout-defect");
    const defect = new Error("Invalid layout state");
    const exit = Effect.runSyncExit(
      views.setViewBounds(view.viewId, {
        x: 0,
        y: 0,
        height: 300,
        get width(): number {
          throw defect;
        },
      }),
    );
    assert(Exit.isFailure(exit));
    expect(Cause.hasFails(exit.cause)).toBe(false);
    expect(Cause.squash(exit.cause)).toBe(defect);
  });

  it("resolves distinct views, including views of the same app, and forgets removed callers", () => {
    const first = create("app.first");
    const second = create("app.shared");
    const third = create("app.shared");
    expect(views.getAppIdByWebContentsId(first.contents.id)).toBe("app.first");
    expect(views.getViewIdByWebContentsId(first.contents.id)).toBe(
      first.viewId,
    );
    for (const view of [second, third]) {
      expect(views.getAppIdByWebContentsId(view.contents.id)).toBe(
        "app.shared",
      );
      expect(views.getViewIdByWebContentsId(view.contents.id)).toBe(
        view.viewId,
      );
    }
    expect(views.getAppIdByWebContentsId(-1)).toBeUndefined();
    expect(views.getViewIdByWebContentsId(-1)).toBeUndefined();

    Effect.runSync(views.removeView(second.viewId));
    const replacement = create("app.shared");
    expect(views.getAppIdByWebContentsId(second.contents.id)).toBeUndefined();
    expect(views.getViewIdByWebContentsId(second.contents.id)).toBeUndefined();
    expect(views.getViewIdByWebContentsId(third.contents.id)).toBe(
      third.viewId,
    );
    expect(views.getAppIdByWebContentsId(first.contents.id)).toBe("app.first");
    expect(views.getViewIdByWebContentsId(replacement.contents.id)).toBe(
      replacement.viewId,
    );
  });

  it("forgets externally destroyed views during layer cleanup", () => {
    const closed = create("app.closed");
    const surviving = create("app.surviving");
    closed.contents.close();

    Effect.runSync(views.showView(surviving.viewId));

    expect(views.getViewInfo(closed.viewId)).toBeUndefined();
    expect(views.getAppIdByWebContentsId(closed.contents.id)).toBeUndefined();
    expect(views.getViewIdByWebContentsId(closed.contents.id)).toBeUndefined();
    expect(views.getViewIdByWebContentsId(surviving.contents.id)).toBe(
      surviving.viewId,
    );
  });

  it("does not retain callers when creation fails after the view is registered", () => {
    const surviving = create("app.surviving");
    const createPlatformView = platform.windows.createView.bind(
      platform.windows,
    );
    jest
      .spyOn(platform.windows, "createView")
      .mockImplementationOnce((options) => {
        const view = createPlatformView(options);
        const on = view.webContents.on.bind(view.webContents);
        jest
          .spyOn(view.webContents, "on")
          .mockImplementation((event, listener) => {
            if (event === "focus") throw new Error("Focus tracking failed");
            return on(event, listener);
          });
        return view;
      });

    expect(() => create("app.failed")).toThrow(
      expect.objectContaining({
        _tag: "ViewNativeFailure",
        operation: "register",
        appId: "app.failed",
        cause: expect.objectContaining({ message: "Focus tracking failed" }),
      }),
    );
    const failed = platform.windows.views.at(-1);
    assert(failed, "Failed native view was not captured");
    expect(failed.webContents.isDestroyed()).toBe(true);
    expect(
      views.getAppIdByWebContentsId(failed.webContents.id),
    ).toBeUndefined();
    expect(
      views.getViewIdByWebContentsId(failed.webContents.id),
    ).toBeUndefined();
    expect(views.getViewIdByWebContentsId(surviving.contents.id)).toBe(
      surviving.viewId,
    );
  });

  it("forgets a caller even when closing its web contents fails", () => {
    const view = create("app.failed-close");
    const close = jest
      .spyOn(view.contents, "close")
      .mockImplementationOnce(() => {
        throw new Error("Close failed");
      });
    try {
      expect(() => Effect.runSync(views.removeView(view.viewId))).toThrow(
        ViewNativeFailure,
      );
      expect(view.contents.isDestroyed()).toBe(true);
      expect(views.getAppIdByWebContentsId(view.contents.id)).toBeUndefined();
      expect(views.getViewIdByWebContentsId(view.contents.id)).toBeUndefined();
    } finally {
      close.mockRestore();
      view.contents.close();
    }
  });

  it("forgets all callers when the owning scope is disposed", async () => {
    const first = create("app.first");
    const second = create("app.second");

    await effects.dispose();

    for (const view of [first, second]) {
      expect(views.getAppIdByWebContentsId(view.contents.id)).toBeUndefined();
      expect(views.getViewIdByWebContentsId(view.contents.id)).toBeUndefined();
      expect(view.contents.isDestroyed()).toBe(true);
    }
  });
});

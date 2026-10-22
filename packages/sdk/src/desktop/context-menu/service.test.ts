import assert from "node:assert/strict";
import type { ContextMenuOpenEvent, ContextMenuResult } from "@edenapp/types";
import * as Effect from "effect/Effect";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import type { TargetedNotification } from "../../core/controllers/events";
import { ContextMenuViews } from "./ports";
import { ContextMenu, ContextMenuLive } from "./service";

async function scenario() {
  const runtime = createEffectRuntime();
  const viewState = new Map([
    [
      10,
      {
        alive: true,
        bounds: { x: 0, y: 0, width: 1024, height: 768 },
        scale: 1,
      },
    ],
    [
      20,
      {
        alive: true,
        bounds: { x: 10, y: 20, width: 300, height: 200 },
        scale: 1,
      },
    ],
    [
      21,
      {
        alive: true,
        bounds: { x: 100, y: 200, width: 400, height: 300 },
        scale: 1,
      },
    ],
  ]);
  const views: ContextMenuViews = {
    resolve: (id) =>
      new Map([
        [100, 10],
        [200, 20],
        [201, 21],
      ]).get(id),
    get: (id) => Effect.sync(() => viewState.get(id)),
    windowSize: () => ({ width: 1024, height: 768 }),
  };
  const menu = await runtime.acquire(
    buildService(ContextMenu, ContextMenuLive).pipe(
      Effect.provideService(ContextMenuViews, views),
    ),
  );
  const opened: TargetedNotification<{ menu: ContextMenuOpenEvent }>[] = [];
  const closed: TargetedNotification<ContextMenuResult>[] = [];
  menu.opened.on((event) => {
    opened.push(event);
  });
  menu.closed.on((event) => {
    closed.push(event);
  });
  return { runtime, menu, opened, closed, viewState, run: runtime.run };
}

type Scenario = Awaited<ReturnType<typeof scenario>>;
const provider = { appId: "com.example.display", webContentsId: 100 };
const opener = { appId: "com.example.editor", webContentsId: 200 };
const other = { appId: "com.example.notes", webContentsId: 201 };

describe("context menus", () => {
  let s: Scenario;

  beforeEach(async () => {
    s = await scenario();
  });
  afterEach(async () => {
    await s.runtime.dispose();
  });

  it("registers a display provider and opens a menu for provider and opener", async () => {
    await s.run(s.menu.registerDisplayProvider(provider));
    const result = await s.run(
      s.menu.openMenu(
        {
          position: { left: 5, top: 6 },
          items: [{ type: "item", id: "open", label: "Open" }],
        },
        opener,
      ),
    );
    expect(result.requestId).toEqual(expect.any(String));
    expect(s.opened).toEqual([
      {
        viewIds: [10, 20],
        payload: {
          menu: {
            requestId: result.requestId,
            position: { left: 15, top: 26 },
            title: undefined,
            items: [{ type: "item", id: "open", label: "Open" }],
          },
        },
      },
    ]);
  });

  it("scales renderer coordinates by the opener view zoom factor", async () => {
    const view = s.viewState.get(20);
    assert(view, "Missing opener view");
    view.scale = 1.5;
    await s.run(s.menu.registerDisplayProvider(provider));
    await s.run(
      s.menu.openMenu(
        {
          position: { left: 40, top: 60, right: 8, bottom: 12 },
          items: [],
        },
        opener,
      ),
    );
    expect(s.opened[0].payload.menu.position).toEqual({
      left: 70,
      top: 110,
      right: 726,
      bottom: 566,
    });
  });

  it("prevents the display provider from opening context menus", async () => {
    await s.run(s.menu.registerDisplayProvider(provider));
    await expect(
      s.run(
        s.menu.openMenu({ position: { left: 0, top: 0 }, items: [] }, provider),
      ),
    ).rejects.toThrow("Display provider cannot open context menus");
  });

  it("allows only the opener to close a context menu", async () => {
    await s.run(s.menu.registerDisplayProvider(provider));
    const { requestId } = await s.run(
      s.menu.openMenu({ position: { left: 0, top: 0 }, items: [] }, opener),
    );
    await expect(s.run(s.menu.closeMenu(requestId, other))).rejects.toThrow(
      "Only the original opener can close this menu",
    );
    expect(s.closed).toEqual([]);
    await expect(s.run(s.menu.closeMenu(requestId, opener))).resolves.toEqual({
      success: true,
    });
    expect(s.closed).toEqual([
      {
        viewIds: [10, 20],
        payload: { requestId, reason: "close" },
      },
    ]);
  });

  it("closes a replaced menu for its original audience and resolves the new request only once", async () => {
    await s.run(s.menu.registerDisplayProvider(provider));
    const first = await s.run(
      s.menu.openMenu({ position: {}, items: [] }, opener),
    );
    const second = await s.run(
      s.menu.openMenu({ position: {}, items: [] }, other),
    );
    expect(s.closed).toEqual([
      {
        viewIds: [10, 20],
        payload: { requestId: first.requestId, reason: "replaced" },
      },
    ]);
    expect(s.opened[1].viewIds).toEqual([10, 21]);
    await expect(
      s.run(
        s.menu.resolveMenu({ requestId: first.requestId, reason: "dismiss" }),
      ),
    ).resolves.toEqual({ success: false });
    const result: ContextMenuResult = {
      requestId: second.requestId,
      reason: "select",
      itemId: "save",
    };
    await expect(s.run(s.menu.resolveMenu(result))).resolves.toEqual({
      success: true,
    });
    expect(s.closed[1]).toEqual({ viewIds: [10, 21], payload: result });
    await expect(s.run(s.menu.resolveMenu(result))).resolves.toEqual({
      success: false,
    });
  });

  it("skips a destroyed provider and releases event listeners when its scope closes", async () => {
    await s.run(s.menu.registerDisplayProvider(provider));
    const view = s.viewState.get(10);
    assert(view, "Missing provider view");
    view.alive = false;
    await s.run(s.menu.openMenu({ position: {}, items: [] }, opener));
    expect(s.opened[0].viewIds).toEqual([20]);
    await s.runtime.dispose();
    expect(s.menu.opened.hasListeners()).toBe(false);
    expect(s.menu.closed.hasListeners()).toBe(false);
    expect(s.closed).toEqual([]);
  });
});

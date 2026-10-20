import * as Effect from "effect/Effect";
import { ContextMenuViewReadFailed } from "../../../src/context-menu/errors";
import { ContextMenuViews } from "../../../src/context-menu/ports";
import {
  ContextMenu,
  ContextMenuLive,
} from "../../../src/context-menu/service";
import { createContextMenuViews } from "../../../src/context-menu/views";
import type { ViewInfo } from "../../../src/views/types";
import { testApp } from "../../support/apps";
import {
  buildService,
  createEffectRuntime,
} from "../../support/effect-runtime";
import { InMemoryPlatform } from "../../support/InMemoryPlatform";

async function scenario() {
  const runtime = createEffectRuntime();
  const platform = new InMemoryPlatform("/context-menu");
  const view = platform.windows.createView({ webPreferences: {} });
  const info: ViewInfo = {
    id: 20,
    appId: "com.example.editor",
    manifest: testApp("com.example.editor"),
    view,
    bounds: { x: 10, y: 20, width: 300, height: 200 },
    requestedVisible: true,
    visible: true,
    mode: "floating",
    viewType: "app",
  };
  const views = createContextMenuViews({
    getViewIdByWebContentsId: (id) =>
      id === view.webContents.id ? 20 : undefined,
    getViewInfo: (id) => (id === 20 ? info : undefined),
    getWindowSize: () => ({ width: 1024, height: 768 }),
  });
  const menu = await runtime.acquire(
    buildService(ContextMenu, ContextMenuLive).pipe(
      Effect.provideService(ContextMenuViews, views),
    ),
  );
  return {
    runtime,
    view,
    views,
    menu,
    caller: { appId: info.appId, webContentsId: view.webContents.id },
  };
}

describe("context menu native view adaptation", () => {
  let s: Awaited<ReturnType<typeof scenario>>;
  beforeEach(async () => {
    s = await scenario();
  });
  afterEach(async () => {
    await s.runtime.dispose();
    s.view.webContents.close();
  });

  it("uses native zoom for menu coordinates and preserves absent or destroyed views", async () => {
    s.view.webContents.setZoomFactor(1.5);
    const opened: unknown[] = [];
    s.menu.opened.on((event) => {
      opened.push(event.payload.menu.position);
    });
    await s.runtime.run(
      s.menu.openMenu({ position: { left: 40, top: 60 }, items: [] }, s.caller),
    );
    expect(opened).toEqual([{ left: 70, top: 110 }]);
    await expect(s.runtime.run(s.views.get(999))).resolves.toBeUndefined();
    s.view.webContents.close();
    s.view.webContents.getZoomFactor = () => {
      throw new Error("Destroyed zoom must not be read");
    };
    await expect(s.runtime.run(s.views.get(20))).resolves.toMatchObject({
      alive: false,
      scale: 1,
    });
  });

  it("preserves a native read failure and does not announce an unopened menu", async () => {
    const cause = new Error("Object has been destroyed");
    s.view.webContents.getZoomFactor = () => {
      throw cause;
    };
    const opened: unknown[] = [];
    s.menu.opened.on((event) => {
      opened.push(event);
    });
    const failure = await s.runtime.run(
      s.menu.openMenu({ position: {}, items: [] }, s.caller).pipe(Effect.flip),
    );
    expect(failure).toBeInstanceOf(ContextMenuViewReadFailed);
    expect(failure).toMatchObject({
      viewId: 20,
      cause,
      message: cause.message,
    });
    expect(opened).toEqual([]);
  });
});

import type { AppManifest } from "@edenapp/types";
import { TilingController } from "./TilingController";
import type { ViewInfo } from "./types";

function createTiledView(
  id: number,
  options: {
    visible: boolean;
    tileIndex: number;
    lastFocusedAt?: number;
    requestedVisible?: boolean;
  },
): ViewInfo {
  return {
    id,
    appId: `app-${id}`,
    manifest: {} as AppManifest,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    requestedVisible: options.requestedVisible ?? options.visible,
    visible: options.visible,
    mode: "tiled",
    viewType: "app",
    tileIndex: options.tileIndex,
    lastFocusedAt: options.lastFocusedAt,
    view: {} as ViewInfo["view"],
  };
}

describe("TilingController.resolveTiledVisibilityChanges", () => {
  it("keeps the preferred tiled view visible when capacity is full", () => {
    const controller = new TilingController({
      mode: "grid",
      rows: 1,
      columns: 2,
      gap: 0,
      padding: 0,
    });
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, { visible: true, tileIndex: 0, lastFocusedAt: 10 }),
      ],
      [
        2,
        createTiledView(2, { visible: true, tileIndex: 1, lastFocusedAt: 20 }),
      ],
      [
        3,
        createTiledView(3, {
          visible: false,
          tileIndex: 2,
          lastFocusedAt: 30,
          requestedVisible: true,
        }),
      ],
    ]);

    expect(
      controller.resolveTiledVisibilityChanges(views, { preferredViewId: 3 }),
    ).toEqual({
      toHide: [1],
      toShow: [3],
    });
  });

  it("fills newly available smart capacity without swapping the current visible set", () => {
    const controller = new TilingController(
      {
        mode: "smart",
        minTileWidth: 388,
        minTileHeight: 480,
        gap: 10,
        padding: 0,
      },
      { x: 0, y: 0, width: 760, height: 900 },
    );
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, { visible: true, tileIndex: 0, lastFocusedAt: 10 }),
      ],
      [
        2,
        createTiledView(2, {
          visible: false,
          tileIndex: 1,
          lastFocusedAt: 20,
          requestedVisible: true,
        }),
      ],
    ]);

    expect(controller.resolveTiledVisibilityChanges(views)).toEqual({
      toHide: [],
      toShow: [],
    });

    controller.setWorkspaceBounds({ x: 0, y: 0, width: 1200, height: 1000 });

    expect(controller.resolveTiledVisibilityChanges(views)).toEqual({
      toHide: [],
      toShow: [2],
    });
  });

  it("does not evict another tile when the preferred view is already visible", () => {
    const controller = new TilingController({
      mode: "grid",
      rows: 2,
      columns: 2,
      gap: 0,
      padding: 0,
    });
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, { visible: true, tileIndex: 0, lastFocusedAt: 10 }),
      ],
      [
        2,
        createTiledView(2, { visible: true, tileIndex: 1, lastFocusedAt: 20 }),
      ],
      [
        3,
        createTiledView(3, { visible: true, tileIndex: 2, lastFocusedAt: 30 }),
      ],
      [
        4,
        createTiledView(4, { visible: true, tileIndex: 3, lastFocusedAt: 40 }),
      ],
    ]);

    expect(
      controller.resolveTiledVisibilityChanges(views, { preferredViewId: 4 }),
    ).toEqual({
      toHide: [],
      toShow: [],
    });
  });

  it("does not auto-promote a user-hidden tiled view into a free slot", () => {
    const controller = new TilingController(
      {
        mode: "smart",
        minTileWidth: 388,
        minTileHeight: 480,
        gap: 10,
        padding: 0,
      },
      { x: 0, y: 0, width: 760, height: 900 },
    );
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, { visible: true, tileIndex: 0, lastFocusedAt: 10 }),
      ],
      [
        2,
        createTiledView(2, {
          visible: false,
          tileIndex: 1,
          lastFocusedAt: 30,
          requestedVisible: false,
        }),
      ],
      [
        3,
        createTiledView(3, {
          visible: false,
          tileIndex: 2,
          lastFocusedAt: 20,
          requestedVisible: true,
        }),
      ],
    ]);

    controller.setWorkspaceBounds({ x: 0, y: 0, width: 1200, height: 1000 });

    expect(controller.resolveTiledVisibilityChanges(views)).toEqual({
      toHide: [],
      toShow: [3],
    });
  });
});

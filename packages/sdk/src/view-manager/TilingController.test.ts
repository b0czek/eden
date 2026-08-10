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
    minSize?: { width: number; height: number };
    maxSize?: { width: number; height: number };
  },
): ViewInfo {
  return {
    id,
    appId: `app-${id}`,
    manifest: {
      name: `App ${id}`,
      window:
        options.minSize || options.maxSize
          ? {
              mode: "tiled",
              minSize: options.minSize,
              maxSize: options.maxSize,
            }
          : undefined,
    } as AppManifest,
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    requestedVisible: options.requestedVisible ?? options.visible,
    visible: options.visible,
    mode: "tiled",
    viewType: "app",
    tileIndex: options.tileIndex,
    lastFocusedAt: options.lastFocusedAt,
    view: {
      webContents: {
        isDestroyed: () => false,
      },
      setBounds: jest.fn(),
    } as unknown as ViewInfo["view"],
  };
}

describe("TilingController tile layout actions", () => {
  function createHorizontalPair(options: { firstMaxWidth?: number } = {}) {
    const controller = new TilingController(
      {
        mode: "horizontal",
        columns: 2,
        gap: 10,
        padding: 0,
      },
      { x: 0, y: 0, width: 1000, height: 600 },
    );
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, {
          visible: true,
          tileIndex: 0,
          maxSize: options.firstMaxWidth
            ? { width: options.firstMaxWidth, height: 600 }
            : undefined,
        }),
      ],
      [2, createTiledView(2, { visible: true, tileIndex: 1 })],
    ]);
    controller.recalculateTiledViews(views);
    return { controller, views };
  }

  it("discovers spatial neighbors and reports supported actions", () => {
    const { controller, views } = createHorizontalPair();

    expect(controller.getTileLayoutState(1, views)).toEqual({
      mode: "tiled",
      neighbors: {
        right: {
          name: "App 2",
          canExpand: true,
        },
      },
    });
  });

  it("maps all four edges around a tile in a grid", () => {
    const controller = new TilingController(
      {
        mode: "grid",
        rows: 3,
        columns: 3,
        gap: 0,
        padding: 0,
      },
      { x: 0, y: 0, width: 900, height: 900 },
    );
    const views = new Map<number, ViewInfo>(
      Array.from({ length: 9 }, (_, index) => {
        const id = index + 1;
        return [id, createTiledView(id, { visible: true, tileIndex: index })];
      }),
    );
    controller.recalculateTiledViews(views);

    const state = controller.getTileLayoutState(5, views);
    expect(state.neighbors.top?.name).toBe("App 2");
    expect(state.neighbors.right?.name).toBe("App 6");
    expect(state.neighbors.bottom?.name).toBe("App 8");
    expect(state.neighbors.left?.name).toBe("App 4");
    expect(Object.values(state.neighbors).every((item) => item.canExpand)).toBe(
      true,
    );
  });

  it("swaps adjacent tiles according to their visual direction", () => {
    const { controller, views } = createHorizontalPair();

    expect(controller.swapTile(1, "right", views)).toBe(true);
    controller.recalculateTiledViews(views);

    expect(views.get(1)?.bounds).toEqual({
      x: 505,
      y: 0,
      width: 495,
      height: 600,
    });
    expect(views.get(2)?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 495,
      height: 600,
    });
    expect(controller.getTileLayoutState(1, views).neighbors.left?.name).toBe(
      "App 2",
    );
  });

  it("covers an adjacent tile and restores the original split", () => {
    const { controller, views } = createHorizontalPair();

    expect(controller.expandTile(1, "right", views)).toBe(true);
    controller.recalculateTiledViews(views);

    expect(views.get(1)?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1000,
      height: 600,
    });
    expect(views.get(2)?.bounds).toEqual({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    });
    expect(controller.getTileLayoutState(1, views)).toEqual({
      mode: "tiled",
      neighbors: {},
    });

    expect(controller.swapTile(1, "right", views)).toBe(false);
    controller.recalculateTiledViews(views);
    expect(views.get(1)?.bounds.width).toBe(1000);
    expect(views.get(2)?.bounds.width).toBe(0);

    expect(controller.restoreExpansionForView(1)).toBe(true);
    controller.recalculateTiledViews(views);

    expect(views.get(1)?.bounds.width).toBe(495);
    expect(views.get(2)?.bounds).toEqual({
      x: 505,
      y: 0,
      width: 495,
      height: 600,
    });
  });

  it("keeps expand unavailable when the caller's maximum size forbids it", () => {
    const { controller, views } = createHorizontalPair({ firstMaxWidth: 600 });

    expect(
      controller.getTileLayoutState(1, views).neighbors.right?.canExpand,
    ).toBe(false);
    expect(controller.expandTile(1, "right", views)).toBe(false);
  });
});

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

  it("respects per-app minSize in grid mode", () => {
    const controller = new TilingController(
      {
        mode: "grid",
        rows: 1,
        columns: 2,
        gap: 0,
        padding: 0,
      },
      { x: 0, y: 0, width: 800, height: 600 },
    );
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, {
          visible: true,
          tileIndex: 0,
          lastFocusedAt: 10,
          minSize: { width: 600, height: 400 },
        }),
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

    expect(
      controller.resolveTiledVisibilityChanges(views, { preferredViewId: 2 }),
    ).toEqual({
      toHide: [1],
      toShow: [2],
    });
  });

  it("respects per-app minSize in horizontal mode", () => {
    const controller = new TilingController(
      {
        mode: "horizontal",
        columns: 2,
        gap: 0,
        padding: 0,
      },
      { x: 0, y: 0, width: 800, height: 600 },
    );
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, {
          visible: true,
          tileIndex: 0,
          lastFocusedAt: 10,
          minSize: { width: 600, height: 400 },
        }),
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

    expect(
      controller.resolveTiledVisibilityChanges(views, { preferredViewId: 2 }),
    ).toEqual({
      toHide: [1],
      toShow: [2],
    });
  });

  it("drops smart layout to a single visible app when another split would violate minSize", () => {
    const controller = new TilingController(
      {
        mode: "smart",
        minTileWidth: 300,
        minTileHeight: 250,
        gap: 10,
        padding: 0,
      },
      { x: 0, y: 0, width: 1200, height: 800 },
    );
    const views = new Map<number, ViewInfo>([
      [
        1,
        createTiledView(1, {
          visible: true,
          tileIndex: 0,
          lastFocusedAt: 10,
          minSize: { width: 1000, height: 700 },
        }),
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

    expect(
      controller.resolveTiledVisibilityChanges(views, { preferredViewId: 2 }),
    ).toEqual({
      toHide: [1],
      toShow: [2],
    });
  });
});

describe("TilingController.determineViewMode", () => {
  it("uses defaultMode when an app supports both modes", () => {
    const controller = new TilingController({
      mode: "grid",
      rows: 1,
      columns: 1,
      gap: 0,
      padding: 0,
    });

    expect(
      controller.determineViewMode({
        mode: "both",
        defaultMode: "floating",
      }),
    ).toBe("floating");
  });

  it("falls back to tiling state when defaultMode is not set", () => {
    const tiledController = new TilingController({
      mode: "grid",
      rows: 1,
      columns: 1,
      gap: 0,
      padding: 0,
    });
    const floatingController = new TilingController({
      mode: "none",
      gap: 0,
      padding: 0,
    });

    expect(
      tiledController.determineViewMode({
        mode: "both",
      }),
    ).toBe("tiled");
    expect(
      floatingController.determineViewMode({
        mode: "both",
      }),
    ).toBe("floating");
  });
});

describe("TilingController.recalculateTiledViews", () => {
  it("centers tiled apps within their cell when maxSize is smaller than the tile", () => {
    const controller = new TilingController(
      {
        mode: "smart",
        minTileWidth: 300,
        minTileHeight: 250,
        gap: 0,
        padding: 0,
      },
      { x: 0, y: 0, width: 1200, height: 800 },
    );
    const view = createTiledView(1, {
      visible: true,
      tileIndex: 0,
      maxSize: { width: 600, height: 400 },
    });
    const views = new Map<number, ViewInfo>([[1, view]]);

    controller.recalculateTiledViews(views);

    expect(view.bounds).toEqual({
      x: 300,
      y: 200,
      width: 600,
      height: 400,
    });
    expect(view.view.setBounds).toHaveBeenCalledWith(view.bounds);
  });
});

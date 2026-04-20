import {
  calculateTileBounds,
  getSmartTilingCapacity,
} from "./layoutCalculator";

describe("calculateTileBounds", () => {
  it("returns padded bounds for no-tiling or zero visible items", () => {
    const workspace = { x: 0, y: 0, width: 100, height: 50 };

    const none = calculateTileBounds({
      workspace,
      tileIndex: 0,
      visibleCount: 1,
      config: { mode: "none", padding: 5 },
    });

    expect(none).toEqual({ x: 5, y: 5, width: 90, height: 40 });

    const zero = calculateTileBounds({
      workspace,
      tileIndex: 0,
      visibleCount: 0,
      config: { mode: "grid", padding: 8 },
    });

    expect(zero).toEqual({ x: 8, y: 8, width: 84, height: 34 });
  });

  it("calculates horizontal tiling with gaps", () => {
    const workspace = { x: 0, y: 0, width: 100, height: 20 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 1,
      visibleCount: 3,
      config: { mode: "horizontal", gap: 2 },
    });

    // (100 - 2*2) / 3 = 32
    expect(bounds.width).toBeCloseTo(32, 5);
    expect(bounds.height).toBeCloseTo(20, 5);
    expect(bounds.x).toBeCloseTo(34, 5); // 32 + 2 gap
    expect(bounds.y).toBe(0);
  });

  it("calculates vertical tiling", () => {
    const workspace = { x: 10, y: 0, width: 40, height: 90 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 2,
      visibleCount: 3,
      config: { mode: "vertical", gap: 5 },
    });

    // (90 - 2*5) / 3 = 26.666...
    expect(bounds.width).toBeCloseTo(40, 5);
    expect(bounds.height).toBeCloseTo(26.6667, 4);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBeCloseTo(63.3333, 4); // row 2
  });

  it("calculates grid tiling with configured rows/columns", () => {
    const workspace = { x: 0, y: 0, width: 80, height: 60 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 3,
      visibleCount: 4,
      config: { mode: "grid", rows: 2, columns: 2, gap: 4, padding: 2 },
    });

    // After padding: 76x56
    // Tile width: (76 - 4) / 2 = 36
    // Tile height: (56 - 4) / 2 = 26
    expect(bounds).toEqual({
      x: 2 + 1 * (36 + 4),
      y: 2 + 1 * (26 + 4),
      width: 36,
      height: 26,
    });
  });

  it("stretches the last partially filled grid row to consume the free width", () => {
    const workspace = { x: 0, y: 0, width: 100, height: 100 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 2,
      visibleCount: 3,
      config: { mode: "grid", rows: 2, columns: 2, gap: 0 },
    });

    expect(bounds).toEqual({
      x: 0,
      y: 50,
      width: 100,
      height: 50,
    });
  });

  it("prefers a tall spanning tile when that better matches the target aspect ratio", () => {
    const workspace = { x: 0, y: 0, width: 100, height: 100 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 2,
      visibleCount: 3,
      config: {
        mode: "grid",
        rows: 2,
        columns: 2,
        gap: 0,
        minTileWidth: 300,
        minTileHeight: 600,
      },
    });

    expect(bounds).toEqual({
      x: 50,
      y: 0,
      width: 50,
      height: 100,
    });
  });

  it("collapses unused grid rows when there are fewer views than configured cells", () => {
    const workspace = { x: 0, y: 0, width: 120, height: 90 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 0,
      visibleCount: 1,
      config: { mode: "grid", rows: 2, columns: 2, gap: 0 },
    });

    expect(bounds).toEqual({
      x: 0,
      y: 0,
      width: 120,
      height: 90,
    });
  });

  it("calculates smart tiling from minimum tile size constraints", () => {
    const workspace = { x: 0, y: 0, width: 1000, height: 700 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 4,
      visibleCount: 5,
      config: {
        mode: "smart",
        minTileWidth: 300,
        minTileHeight: 250,
        gap: 10,
      },
    });

    // Smart mode chooses a 3-column, 2-row grid, then stretches the partial
    // last row across the full width:
    // width = (1000 - 10) / 2 = 495
    // height = (700 - 10) / 2 = 345
    expect(bounds.width).toBeCloseTo(495, 5);
    expect(bounds.height).toBeCloseTo(345, 5);
    expect(bounds.x).toBeCloseTo(505, 5);
    expect(bounds.y).toBeCloseTo(355, 5);
  });

  it("falls back to the most balanced smart layout when constraints cannot all be met", () => {
    const workspace = { x: 0, y: 0, width: 500, height: 350 };
    const bounds = calculateTileBounds({
      workspace,
      tileIndex: 3,
      visibleCount: 4,
      config: {
        mode: "smart",
        minTileWidth: 320,
        minTileHeight: 220,
        gap: 10,
      },
    });

    // No layout satisfies both constraints. The fallback prefers 2x2:
    // width = (500 - 10) / 2 = 245
    // height = (350 - 10) / 2 = 170
    expect(bounds).toEqual({
      x: 255,
      y: 180,
      width: 245,
      height: 170,
    });
  });

  it("limits smart tiling capacity to one when two apps cannot meet minimum size", () => {
    const workspace = { x: 0, y: 0, width: 760, height: 900 };

    expect(
      getSmartTilingCapacity(workspace, {
        minTileWidth: 388,
        minTileHeight: 480,
        gap: 10,
      }),
    ).toBe(1);
  });

  it("computes the maximum smart tiling capacity that still respects minimum size", () => {
    const workspace = { x: 0, y: 0, width: 1200, height: 1000 };

    expect(
      getSmartTilingCapacity(workspace, {
        minTileWidth: 388,
        minTileHeight: 480,
        gap: 10,
      }),
    ).toBe(6);
  });
});

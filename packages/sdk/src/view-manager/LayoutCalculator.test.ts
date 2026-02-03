import { LayoutCalculator } from "./LayoutCalculator";

describe("LayoutCalculator", () => {
  it("returns padded bounds for no-tiling or zero visible items", () => {
    const workspace = { x: 0, y: 0, width: 100, height: 50 };

    const none = LayoutCalculator.calculateTileBounds({
      workspace,
      tileIndex: 0,
      visibleCount: 1,
      config: { mode: "none", padding: 5 },
    });

    expect(none).toEqual({ x: 5, y: 5, width: 90, height: 40 });

    const zero = LayoutCalculator.calculateTileBounds({
      workspace,
      tileIndex: 0,
      visibleCount: 0,
      config: { mode: "grid", padding: 8 },
    });

    expect(zero).toEqual({ x: 8, y: 8, width: 84, height: 34 });
  });

  it("calculates horizontal tiling with gaps", () => {
    const workspace = { x: 0, y: 0, width: 100, height: 20 };
    const bounds = LayoutCalculator.calculateTileBounds({
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
    const bounds = LayoutCalculator.calculateTileBounds({
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
    const bounds = LayoutCalculator.calculateTileBounds({
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
});

import {
  calculateResizeBounds,
  type ResizeBounds,
  type ResizeConstraints,
} from "./resize-geometry";

const startBounds: ResizeBounds = {
  x: 100,
  y: 80,
  width: 600,
  height: 400,
};

const constraints: ResizeConstraints = {
  minWidth: 200,
  minHeight: 200,
  maxWidth: 800,
  maxHeight: 700,
};

describe("calculateResizeBounds", () => {
  it("resizes the right edge without changing the window position or height", () => {
    expect(
      calculateResizeBounds(startBounds, 75, 50, "right", constraints),
    ).toEqual({
      x: 100,
      y: 80,
      width: 675,
      height: 400,
    });
  });

  it("resizes the bottom edge without changing the window position or width", () => {
    expect(
      calculateResizeBounds(startBounds, 75, 50, "bottom", constraints),
    ).toEqual({
      x: 100,
      y: 80,
      width: 600,
      height: 450,
    });
  });

  it("keeps the right edge anchored while resizing the left edge", () => {
    expect(
      calculateResizeBounds(startBounds, -75, 50, "left", constraints),
    ).toEqual({
      x: 25,
      y: 80,
      width: 675,
      height: 400,
    });
  });

  it("resizes both axes from the bottom-left corner", () => {
    expect(
      calculateResizeBounds(startBounds, 50, 100, "bottom-left", constraints),
    ).toEqual({
      x: 150,
      y: 80,
      width: 550,
      height: 500,
    });
  });

  it("preserves the anchored edge when a size constraint is reached", () => {
    expect(
      calculateResizeBounds(startBounds, 500, 500, "bottom-left", constraints),
    ).toEqual({
      x: 500,
      y: 80,
      width: 200,
      height: 700,
    });
  });
});

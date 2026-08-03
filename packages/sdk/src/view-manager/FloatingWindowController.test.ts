import { FloatingWindowController } from "./FloatingWindowController";

describe("FloatingWindowController.applyWindowConstraints", () => {
  it("scales manifest sizes into physical view bounds", () => {
    const controller = new FloatingWindowController(
      () => ({ x: 0, y: 0, width: 1600, height: 1200 }),
      () => [],
      () => 1.5,
    );

    expect(
      controller.calculateInitialBounds({
        mode: "floating",
        defaultSize: { width: 600, height: 400 },
        minSize: { width: 500, height: 300 },
      }),
    ).toMatchObject({ width: 900, height: 600 });

    expect(
      controller.applyWindowConstraints(
        { x: 0, y: 0, width: 400, height: 300 },
        {
          mode: "floating",
          minSize: { width: 500, height: 300 },
          maxSize: { width: 700, height: 500 },
        },
      ),
    ).toMatchObject({ width: 750, height: 450 });
  });

  it("can leave manually scaled overlay sizes unscaled", () => {
    const controller = new FloatingWindowController(
      () => ({ x: 0, y: 0, width: 1600, height: 1200 }),
      () => [],
      () => 1.5,
    );

    expect(
      controller.calculateInitialBounds(
        {
          mode: "floating",
          defaultSize: { width: 600, height: 400 },
        },
        false,
      ),
    ).toMatchObject({ width: 600, height: 400 });
  });

  it("allows floating windows to extend below the workspace", () => {
    const controller = new FloatingWindowController(
      () => ({ x: 0, y: 0, width: 800, height: 600 }),
      () => [],
    );

    expect(
      controller.applyWindowConstraints({
        x: 100,
        y: 450,
        width: 400,
        height: 300,
      }),
    ).toEqual({
      x: 100,
      y: 450,
      width: 400,
      height: 300,
    });
  });

  it("keeps a grabbable strip visible at the bottom of the workspace", () => {
    const controller = new FloatingWindowController(
      () => ({ x: 0, y: 50, width: 800, height: 600 }),
      () => [],
    );

    expect(
      controller.applyWindowConstraints({
        x: 100,
        y: 700,
        width: 400,
        height: 300,
      }),
    ).toEqual({
      x: 100,
      y: 550,
      width: 400,
      height: 300,
    });
  });
});

import { FloatingWindowController } from "./FloatingWindowController";

describe("FloatingWindowController.applyWindowConstraints", () => {
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

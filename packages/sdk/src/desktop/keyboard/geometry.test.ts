import { calculateDockedKeyboardLift } from "./geometry";

describe("calculateDockedKeyboardLift", () => {
  const contentBounds = { x: 0, y: 0, width: 1280, height: 800 };
  const viewBounds = { x: 0, y: 20, width: 1280, height: 780 };

  it("lifts an obscured target above the docked keyboard", () => {
    expect(
      calculateDockedKeyboardLift({
        keyboardHeight: 250,
        targetBounds: { x: 20, y: 600, width: 200, height: 40 },
        viewBounds,
        contentBounds,
      }),
    ).toBe(126);
  });

  it("converts a scaled target from CSS pixels to view coordinates", () => {
    expect(
      calculateDockedKeyboardLift({
        keyboardHeight: 250,
        targetBounds: { x: 20, y: 400, width: 200, height: 40 },
        targetScale: 1.5,
        viewBounds,
        contentBounds,
      }),
    ).toBe(146);
  });

  it("falls back to an unscaled target for an invalid zoom factor", () => {
    expect(
      calculateDockedKeyboardLift({
        keyboardHeight: 250,
        targetBounds: { x: 20, y: 600, width: 200, height: 40 },
        targetScale: Number.NaN,
        viewBounds,
        contentBounds,
      }),
    ).toBe(126);
  });
});

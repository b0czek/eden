import type { AppManifest } from "@edenapp/types";
import { compareOverlayViews, type ViewInfo } from "./types";

function createOverlay(
  id: number,
  zIndex: number | undefined,
  overlayPriority?: number,
): ViewInfo {
  return {
    id,
    zIndex,
    manifest: {
      window: {
        mode: "floating",
        ...(overlayPriority === undefined ? {} : { overlayPriority }),
      },
    } as AppManifest,
  } as ViewInfo;
}

describe("compareOverlayViews", () => {
  it("orders overlays without a priority by z-index", () => {
    const overlays = [createOverlay(1, 20), createOverlay(2, 10)].sort(
      compareOverlayViews,
    );

    expect(overlays.map((view) => view.id)).toEqual([2, 1]);
  });

  it("places higher-priority overlays above overlays with newer z-indexes", () => {
    const overlays = [createOverlay(1, 1000, 0), createOverlay(2, 1, 100)].sort(
      compareOverlayViews,
    );

    expect(overlays.map((view) => view.id)).toEqual([1, 2]);
  });

  it("treats a missing priority as zero", () => {
    const overlays = [createOverlay(1, 10), createOverlay(2, 10, -1)].sort(
      compareOverlayViews,
    );

    expect(overlays.map((view) => view.id)).toEqual([2, 1]);
  });

  it("uses view ID for deterministic ties", () => {
    const overlays = [
      createOverlay(2, undefined, 10),
      createOverlay(1, undefined, 10),
    ].sort(compareOverlayViews);

    expect(overlays.map((view) => view.id)).toEqual([1, 2]);
  });
});

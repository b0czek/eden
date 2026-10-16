import type { Bounds } from "../platform/ports";
export function createViewPresentation() {
  let _viewLift = 0;

  function setViewLift(nextLift: number): boolean {
    const normalizedLift = Math.max(0, Math.round(nextLift));
    if (normalizedLift === _viewLift) {
      return false;
    }

    _viewLift = normalizedLift;
    return true;
  }

  function getViewLift(): number {
    return _viewLift;
  }

  function applyToBounds(bounds: Bounds): Bounds {
    if (_viewLift <= 0) {
      return { ...bounds };
    }

    return {
      ...bounds,
      y: bounds.y - _viewLift,
    };
  }
  return { setViewLift, getViewLift, applyToBounds };
}

export type ViewPresentation = ReturnType<typeof createViewPresentation>;

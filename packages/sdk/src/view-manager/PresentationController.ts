import type { Rectangle as Bounds } from "electron";

/**
 * Applies transient shell-owned offsets to hosted web contents without mutating
 * their logical bounds. Used by the docked keyboard to lift the full scene.
 */
export class PresentationController {
  private viewLift = 0;

  setViewLift(nextLift: number): boolean {
    const normalizedLift = Math.max(0, Math.round(nextLift));
    if (normalizedLift === this.viewLift) {
      return false;
    }

    this.viewLift = normalizedLift;
    return true;
  }

  getViewLift(): number {
    return this.viewLift;
  }

  applyToBounds(bounds: Bounds): Bounds {
    if (this.viewLift <= 0) {
      return { ...bounds };
    }

    return {
      ...bounds,
      y: bounds.y - this.viewLift,
    };
  }
}

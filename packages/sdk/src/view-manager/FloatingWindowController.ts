import { Rectangle as Bounds } from "electron";
import { WindowConfig } from "@edenapp/types";
import { ViewInfo } from "./types";

type ViewCollection = () => Iterable<ViewInfo>;

/**
 * FloatingWindowController
 *
 * Encapsulates floating window calculations: bounds, constraints, and z-ordering.
 */
export class FloatingWindowController {
  private static readonly MIN_GRABBABLE_WIDTH = 100;
  private static readonly CASCADE_OFFSET = 30;

  constructor(
    private readonly getWorkspaceBounds: () => Bounds,
    private readonly getViews: ViewCollection,
  ) {}

  /**
   * Calculate initial bounds for a floating window, including cascade offset.
   */
  calculateInitialBounds(windowConfig?: WindowConfig): Bounds {
    const {
      x: workX,
      y: workY,
      width: workWidth,
      height: workHeight,
    } = this.getWorkspaceBounds();

    const defaultWidth = windowConfig?.defaultSize?.width || 800;
    const defaultHeight = windowConfig?.defaultSize?.height || 600;

    const width = windowConfig?.minSize?.width
      ? Math.max(defaultWidth, windowConfig.minSize.width)
      : windowConfig?.maxSize?.width
        ? Math.min(defaultWidth, windowConfig.maxSize.width)
        : defaultWidth;

    const height = windowConfig?.minSize?.height
      ? Math.max(defaultHeight, windowConfig.minSize.height)
      : windowConfig?.maxSize?.height
        ? Math.min(defaultHeight, windowConfig.maxSize.height)
        : defaultHeight;

    let x: number;
    let y: number;

    if (windowConfig?.defaultPosition) {
      x = workX + windowConfig.defaultPosition.x;
      y = workY + windowConfig.defaultPosition.y;
    } else {
      x = workX + (workWidth - width) / 2;
      y = workY + (workHeight - height) / 2;
    }

    const floatingCount = this.getFloatingViews().length;
    const offset = floatingCount * FloatingWindowController.CASCADE_OFFSET;

    const bounds = {
      x: x + offset,
      y: y + offset,
      width,
      height,
    } as Bounds;

    return this.constrainBounds(bounds);
  }

  /**
   * Apply window-level constraints and workspace bounds to floating windows.
   */
  applyWindowConstraints(bounds: Bounds, windowConfig?: WindowConfig): Bounds {
    let finalBounds = { ...bounds };

    if (windowConfig?.minSize) {
      finalBounds.width = Math.max(
        finalBounds.width,
        windowConfig.minSize.width,
      );
      finalBounds.height = Math.max(
        finalBounds.height,
        windowConfig.minSize.height,
      );
    }

    if (windowConfig?.maxSize) {
      finalBounds.width = Math.min(
        finalBounds.width,
        windowConfig.maxSize.width,
      );
      finalBounds.height = Math.min(
        finalBounds.height,
        windowConfig.maxSize.height,
      );
    }

    return this.constrainBounds(finalBounds);
  }

  /**
   * Get the next z-index for floating windows (top-most position).
   */
  getNextZIndex(): number {
    const zIndices = this.getFloatingViews()
      .map((v) => v.zIndex)
      .filter((z): z is number => typeof z === "number");

    if (zIndices.length === 0) return 1;
    return Math.max(...zIndices) + 1;
  }

  /**
   * Get the z-index that would place a window at the back of the floating stack.
   */
  getBackmostZIndex(): number | undefined {
    const floatingViews = this.getOrderedFloatingViews();
    if (!floatingViews.length) return undefined;
    const minZIndex = floatingViews[0].zIndex ?? 1;
    return minZIndex - 1;
  }

  /**
   * Calculate a z-index for a desired position in the floating stack.
   */
  getZIndexForPosition(position: number): number | undefined {
    const floatingViews = this.getOrderedFloatingViews();
    if (!floatingViews.length) return undefined;

    const targetIndex = Math.max(
      0,
      Math.min(position, floatingViews.length - 1),
    );
    const baseZIndex = floatingViews[0].zIndex ?? 1;
    return baseZIndex + targetIndex;
  }

  /**
   * Get floating views ordered by z-index ascending.
   */
  getOrderedFloatingViews(): ViewInfo[] {
    return this.getFloatingViews().sort(
      (a, b) => (a.zIndex || 0) - (b.zIndex || 0),
    );
  }

  private getFloatingViews(): ViewInfo[] {
    return Array.from(this.getViews()).filter(
      (view) => view.mode === "floating",
    );
  }

  private constrainBounds(bounds: Bounds): Bounds {
    const { x: workX, y: workY, width: workWidth } = this.getWorkspaceBounds();
    const constrainedBounds = { ...bounds };

    constrainedBounds.y = Math.max(workY, constrainedBounds.y);

    const maxX =
      workX + workWidth - FloatingWindowController.MIN_GRABBABLE_WIDTH;
    constrainedBounds.x = Math.min(constrainedBounds.x, maxX);

    const minX =
      workX -
      (constrainedBounds.width - FloatingWindowController.MIN_GRABBABLE_WIDTH);
    constrainedBounds.x = Math.max(constrainedBounds.x, minX);

    return constrainedBounds;
  }
}

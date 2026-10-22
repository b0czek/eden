export const RESIZE_DIRECTIONS = [
  "left",
  "right",
  "bottom",
  "bottom-left",
  "bottom-right",
] as const;

export type ResizeDirection = (typeof RESIZE_DIRECTIONS)[number];

export interface ResizeBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ResizeConstraints {
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}

function constrain(value: number, minimum: number, maximum?: number): number {
  const constrained = Math.max(value, minimum);
  return maximum === undefined ? constrained : Math.min(constrained, maximum);
}

/**
 * Calculate bounds for one of the three resizable window edges.
 * Left-edge resizing keeps the original right edge anchored.
 */
export function calculateResizeBounds(
  startBounds: ResizeBounds,
  deltaX: number,
  deltaY: number,
  direction: ResizeDirection,
  constraints: ResizeConstraints,
): ResizeBounds {
  const resizesLeft = direction === "left" || direction === "bottom-left";
  const resizesRight = direction === "right" || direction === "bottom-right";
  const resizesBottom = direction.startsWith("bottom");

  const width = resizesLeft
    ? constrain(
        startBounds.width - deltaX,
        constraints.minWidth,
        constraints.maxWidth,
      )
    : resizesRight
      ? constrain(
          startBounds.width + deltaX,
          constraints.minWidth,
          constraints.maxWidth,
        )
      : startBounds.width;
  const height = resizesBottom
    ? constrain(
        startBounds.height + deltaY,
        constraints.minHeight,
        constraints.maxHeight,
      )
    : startBounds.height;

  return {
    x: Math.round(
      resizesLeft ? startBounds.x + startBounds.width - width : startBounds.x,
    ),
    y: startBounds.y,
    width: Math.round(width),
    height: Math.round(height),
  };
}

import type { WindowConfig } from "@edenapp/types";
import type { Bounds } from "../platform/ports/types";
import type { ViewInfo } from "./types";

type ViewCollection = () => Iterable<ViewInfo>;
export function createFloatingWindows(
  getWorkspaceBounds: () => Bounds,
  getViews: ViewCollection,
  getInterfaceScale: () => number = () => 1,
) {
  const _MIN_GRABBABLE_WIDTH = 100;
  const _MIN_GRABBABLE_HEIGHT = 100;
  const _CASCADE_OFFSET = 30;
  const _getWorkspaceBounds = getWorkspaceBounds;
  const _getViews = getViews;
  const _getInterfaceScale = getInterfaceScale;

  function scaled(value: number, applyInterfaceScale = true): number {
    return Math.round(value * (applyInterfaceScale ? _getInterfaceScale() : 1));
  }

  function calculateInitialBounds(
    windowConfig?: WindowConfig,
    applyInterfaceScale = true,
  ): Bounds {
    const {
      x: workX,
      y: workY,
      width: workWidth,
      height: workHeight,
    } = _getWorkspaceBounds();

    const defaultWidth = scaled(
      windowConfig?.defaultSize?.width || 800,
      applyInterfaceScale,
    );
    const defaultHeight = scaled(
      windowConfig?.defaultSize?.height || 600,
      applyInterfaceScale,
    );
    const minWidth = windowConfig?.minSize?.width
      ? scaled(windowConfig.minSize.width, applyInterfaceScale)
      : undefined;
    const minHeight = windowConfig?.minSize?.height
      ? scaled(windowConfig.minSize.height, applyInterfaceScale)
      : undefined;
    const maxWidth = windowConfig?.maxSize?.width
      ? scaled(windowConfig.maxSize.width, applyInterfaceScale)
      : undefined;
    const maxHeight = windowConfig?.maxSize?.height
      ? scaled(windowConfig.maxSize.height, applyInterfaceScale)
      : undefined;

    const width = minWidth
      ? Math.max(defaultWidth, minWidth)
      : maxWidth
        ? Math.min(defaultWidth, maxWidth)
        : defaultWidth;

    const height = minHeight
      ? Math.max(defaultHeight, minHeight)
      : maxHeight
        ? Math.min(defaultHeight, maxHeight)
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

    const floatingCount = getFloatingViews().length;
    const offset = floatingCount * _CASCADE_OFFSET;

    const bounds = {
      x: x + offset,
      y: y + offset,
      width,
      height,
    } as Bounds;

    return constrainBounds(bounds);
  }

  function applyWindowConstraints(
    bounds: Bounds,
    windowConfig?: WindowConfig,
    applyInterfaceScale = true,
  ): Bounds {
    const finalBounds = { ...bounds };

    if (windowConfig?.minSize) {
      finalBounds.width = Math.max(
        finalBounds.width,
        scaled(windowConfig.minSize.width, applyInterfaceScale),
      );
      finalBounds.height = Math.max(
        finalBounds.height,
        scaled(windowConfig.minSize.height, applyInterfaceScale),
      );
    }

    if (windowConfig?.maxSize) {
      finalBounds.width = Math.min(
        finalBounds.width,
        scaled(windowConfig.maxSize.width, applyInterfaceScale),
      );
      finalBounds.height = Math.min(
        finalBounds.height,
        scaled(windowConfig.maxSize.height, applyInterfaceScale),
      );
    }

    return constrainBounds(finalBounds);
  }

  function getNextZIndex(): number {
    const zIndices = getFloatingViews()
      .map((v) => v.zIndex)
      .filter((z): z is number => typeof z === "number");

    if (zIndices.length === 0) return 1;
    return Math.max(...zIndices) + 1;
  }

  function getBackmostZIndex(): number | undefined {
    const floatingViews = getOrderedFloatingViews();
    if (!floatingViews.length) return undefined;
    const minZIndex = floatingViews[0].zIndex ?? 1;
    return minZIndex - 1;
  }

  function getZIndexForPosition(position: number): number | undefined {
    const floatingViews = getOrderedFloatingViews();
    if (!floatingViews.length) return undefined;

    const targetIndex = Math.max(
      0,
      Math.min(position, floatingViews.length - 1),
    );
    const baseZIndex = floatingViews[0].zIndex ?? 1;
    return baseZIndex + targetIndex;
  }

  function getOrderedFloatingViews(): ViewInfo[] {
    return getFloatingViews().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  }

  function getFloatingViews(): ViewInfo[] {
    return Array.from(_getViews()).filter((view) => view.mode === "floating");
  }

  function constrainBounds(bounds: Bounds): Bounds {
    const {
      x: workX,
      y: workY,
      width: workWidth,
      height: workHeight,
    } = _getWorkspaceBounds();
    const constrainedBounds = { ...bounds };

    constrainedBounds.y = Math.max(workY, constrainedBounds.y);

    const maxY = Math.max(workY, workY + workHeight - _MIN_GRABBABLE_HEIGHT);
    constrainedBounds.y = Math.min(constrainedBounds.y, maxY);

    const maxX = workX + workWidth - _MIN_GRABBABLE_WIDTH;
    constrainedBounds.x = Math.min(constrainedBounds.x, maxX);

    const minX = workX - (constrainedBounds.width - _MIN_GRABBABLE_WIDTH);
    constrainedBounds.x = Math.max(constrainedBounds.x, minX);

    return constrainedBounds;
  }
  return {
    calculateInitialBounds,
    applyWindowConstraints,
    getNextZIndex,
    getBackmostZIndex,
    getZIndexForPosition,
    getOrderedFloatingViews,
  };
}

export type FloatingWindows = ReturnType<typeof createFloatingWindows>;

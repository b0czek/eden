import { log } from "../logging";
/**
 * Window Resizing
 *
 * Handles resizing for floating windows
 */

import {
  calculateResizeBounds,
  type ResizeDirection,
} from "../view-manager/resize-geometry.js";
import {
  getEdenFrameInternal,
  getScreenCoords,
  syncEdenFrameBounds,
} from "./utils.js";

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BoundsRef {
  current: Bounds | null;
}

/**
 * Setup window resizing for floating windows
 */
export function setupWindowResizing(
  windowConfig: NonNullable<Window["edenFrame"]>["_internal"]["config"],
  currentBoundsRef: BoundsRef,
): () => void {
  const handleDefinitions: Array<{
    direction: ResizeDirection;
    style: string;
  }> = [
    {
      direction: "left",
      style: "top: 40px; bottom: 20px; left: 0; width: 8px; cursor: ew-resize;",
    },
    {
      direction: "right",
      style:
        "top: 40px; right: 0; bottom: 20px; width: 8px; cursor: ew-resize;",
    },
    {
      direction: "bottom",
      style:
        "right: 20px; bottom: 0; left: 20px; height: 8px; cursor: ns-resize;",
    },
    {
      direction: "bottom-left",
      style:
        "bottom: 0; left: 0; width: 20px; height: 20px; cursor: nesw-resize;",
    },
    {
      direction: "bottom-right",
      style:
        "right: 0; bottom: 0; width: 20px; height: 20px; cursor: nwse-resize;",
    },
  ];

  const resizeHandles = handleDefinitions.map(({ direction, style }) => {
    const handle = document.createElement("div");
    handle.id =
      direction === "bottom-right"
        ? "eden-resize-handle"
        : `eden-resize-handle-${direction}`;
    handle.className = "eden-resize-handle";
    handle.dataset.edenResizeDirection = direction;
    handle.ariaHidden = "true";
    handle.style.cssText = `
      all: initial;
      position: fixed;
      ${style}
      z-index: 2147483647;
      -webkit-app-region: no-drag;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
    `;
    document.body.appendChild(handle);
    return { direction, handle };
  });

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let resizeStartBounds: Bounds | null = null;
  let resizeDirection: ResizeDirection = "bottom-right";
  let isTouch = false;
  let rafId: number | null = null;
  let pendingBounds: Bounds | null = null;

  // Animation frame update function - throttles IPC to 60fps
  const updateResizePosition = () => {
    if (pendingBounds) {
      window.edenAPI
        .shellCommand("view/update-bounds", {
          bounds: pendingBounds,
        })
        .catch(log.error);

      pendingBounds = null;
    }

    if (isResizing) {
      rafId = requestAnimationFrame(updateResizePosition);
    }
  };

  const startResize = (
    direction: ResizeDirection,
    e: MouseEvent | TouchEvent,
  ): void => {
    let currentBounds = currentBoundsRef.current;

    // Initialize current bounds if not set
    if (!currentBounds) {
      const initialBounds = getEdenFrameInternal()?.bounds;
      if (initialBounds && initialBounds.x !== undefined) {
        currentBounds = { ...initialBounds };
        currentBoundsRef.current = currentBounds;
      } else {
        log.warn("Cannot start resize - currentBounds not initialized!");
        return;
      }
    }

    isResizing = true;
    isTouch = e.type.startsWith("touch");

    // Get screen coordinates
    const coords = getScreenCoords(e);
    startX = coords.x;
    startY = coords.y;
    resizeStartBounds = { ...currentBounds };
    resizeDirection = direction;

    e.preventDefault();
    e.stopPropagation();

    // Start animation frame loop for smooth updates
    if (isTouch) {
      rafId = requestAnimationFrame(updateResizePosition);
    }

    // NOTE: We do NOT call focus here anymore.
    // On macOS (and Linux touch), calling focus during resize start causes view reordering
    // which cancels the resize/touch event. Instead, we bring the window to front after resize ends.

    // For mouse events, use global tracking in main process
    // For touch events, we'll handle updates in touchmove
    if (!isTouch) {
      window.edenAPI
        .shellCommand("view/start-resize", {
          startX: coords.x,
          startY: coords.y,
          direction,
        })
        .catch(log.error);
    }

    // Add mouseup listener when resize starts (removed when resize ends)
    if (!isTouch) {
      window.addEventListener("mouseup", endResize);
    }
  };

  const moveResize = (e: MouseEvent | TouchEvent): void => {
    if (!isResizing || !resizeStartBounds) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

    // Get current coordinates
    const coords = getScreenCoords(e);
    const deltaX = coords.x - startX;
    const deltaY = coords.y - startY;

    const newBounds = calculateResizeBounds(
      resizeStartBounds,
      deltaX,
      deltaY,
      resizeDirection,
      {
        minWidth: windowConfig.minSize?.width || 200,
        minHeight: windowConfig.minSize?.height || 200,
        maxWidth: windowConfig.maxSize?.width,
        maxHeight: windowConfig.maxSize?.height,
      },
    );

    // Update tracked bounds immediately for next move calculation
    currentBoundsRef.current = newBounds;

    // Store pending update for next animation frame
    pendingBounds = newBounds;
  };

  const endResize = (_e?: MouseEvent | TouchEvent): void => {
    if (!isResizing) {
      return;
    }

    isResizing = false;
    resizeStartBounds = null;

    // Remove mouseup listener since resize is done
    window.removeEventListener("mouseup", endResize);

    // Cancel animation frame and send final position
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;

      // Send final pending bounds immediately
      if (pendingBounds) {
        window.edenAPI
          .shellCommand("view/update-bounds", {
            bounds: pendingBounds,
          })
          .catch(log.error);

        // Update edenFrame._internal.bounds so next interaction starts from correct position
        syncEdenFrameBounds(pendingBounds);
        pendingBounds = null;
      }
    }

    // For touch resize, ensure edenFrame._internal.bounds is updated with final position
    if (isTouch && currentBoundsRef.current) {
      syncEdenFrameBounds(currentBoundsRef.current);
    }

    // Stop global resize tracking in main process (for mouse events)
    if (!isTouch) {
      window.edenAPI.shellCommand("view/end-resize", {}).catch(log.error);
    }

    window.edenAPI.shellCommand("view/focus", {}).catch(log.error);
  };

  const handleListeners = resizeHandles.map(({ direction, handle }) => {
    const listener = (event: MouseEvent | TouchEvent) =>
      startResize(direction, event);
    handle.addEventListener("mousedown", listener);
    handle.addEventListener("touchstart", listener, { passive: false });
    return { handle, listener };
  });

  // Move events for touch (mouse uses main process tracking)
  // Use document and capture to ensure we get all touch moves
  document.addEventListener("touchmove", moveResize, {
    passive: false,
    capture: true,
  });

  // Touch end/cancel events (mouseup is added dynamically when resize starts)
  document.addEventListener("touchend", endResize, { passive: false });
  document.addEventListener("touchcancel", endResize, { passive: false });

  return () => {
    for (const { handle, listener } of handleListeners) {
      handle.removeEventListener("mousedown", listener);
      handle.removeEventListener("touchstart", listener);
      handle.remove();
    }

    document.removeEventListener("touchmove", moveResize, {
      capture: true,
    });
    document.removeEventListener("touchend", endResize);
    document.removeEventListener("touchcancel", endResize);
    window.removeEventListener("mouseup", endResize);

    if (rafId) {
      cancelAnimationFrame(rafId);
    }
  };
}

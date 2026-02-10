import { log } from "../logging";
/**
 * Window Resizing
 *
 * Handles resizing for floating windows
 */

import { getScreenCoords } from "./utils.js";

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
/**
 * Setup window resizing for floating windows
 */
export function setupWindowResizing(
  windowConfig: NonNullable<Window["edenFrame"]>["_internal"]["config"],
  currentBoundsRef: BoundsRef,
): () => void {
  // Create resize handle in bottom-right corner
  const resizeHandle = document.createElement("div");
  resizeHandle.id = "eden-resize-handle";
  resizeHandle.style.cssText = `
    position: fixed;
    bottom: 0;
    right: 0;
    width: 20px;
    height: 20px;
    cursor: nwse-resize;
    z-index: 2147483647;
    -webkit-app-region: no-drag;
    touch-action: none;
  `;

  document.body.appendChild(resizeHandle);

  let isResizing = false;
  let startX = 0;
  let startY = 0;
  let resizeStartBounds: Bounds | null = null;
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

  const startResize = (e: MouseEvent | TouchEvent): void => {
    // Initialize current bounds if not set
    if (!currentBoundsRef.current) {
      const initialBounds = window.edenFrame?._internal.bounds;
      if (initialBounds && initialBounds.x !== undefined) {
        currentBoundsRef.current = { ...initialBounds };
        log.info(
          "Initialized currentBounds from edenFrame._internal.bounds:",
          currentBoundsRef.current,
        );
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
    resizeStartBounds = { ...currentBoundsRef.current };

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
        })
        .catch(log.error);
    }

    // Add mouseup listener when resize starts (removed when resize ends)
    if (!isTouch) {
      window.addEventListener("mouseup", endResize);
    }
  };

  const moveResize = (e: MouseEvent | TouchEvent): void => {
    log.info(
      "moveResize called, isResizing:",
      isResizing,
      "event type:",
      e.type,
    );

    e.preventDefault();
    e.stopPropagation();

    if (!isResizing || !resizeStartBounds) {
      log.info(
        "moveResize returning early - isResizing:",
        isResizing,
        "resizeStartBounds:",
        resizeStartBounds,
      );
      return;
    }

    // Get current coordinates
    const coords = getScreenCoords(e);
    const deltaX = coords.x - startX;
    const deltaY = coords.y - startY;

    log.info("moveResize coords:", coords, "delta:", {
      deltaX,
      deltaY,
    });

    let newWidth = resizeStartBounds.width + deltaX;
    let newHeight = resizeStartBounds.height + deltaY;

    // Apply min/max constraints
    if (windowConfig.minSize) {
      newWidth = Math.max(newWidth, windowConfig.minSize.width || 200);
      newHeight = Math.max(newHeight, windowConfig.minSize.height || 200);
    } else {
      newWidth = Math.max(newWidth, 200);
      newHeight = Math.max(newHeight, 200);
    }

    if (windowConfig.maxSize) {
      newWidth = Math.min(newWidth, windowConfig.maxSize.width || 2000);
      newHeight = Math.min(newHeight, windowConfig.maxSize.height || 2000);
    }

    const newBounds = {
      x: resizeStartBounds.x,
      y: resizeStartBounds.y,
      width: Math.round(newWidth),
      height: Math.round(newHeight),
    };

    log.info("moveResize newBounds:", newBounds);

    // Update tracked bounds immediately for next move calculation
    currentBoundsRef.current = newBounds;

    // Store pending update for next animation frame
    pendingBounds = newBounds;
  };

  const endResize = (e?: MouseEvent | TouchEvent): void => {
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
        window.edenFrame!._internal.bounds = { ...pendingBounds };
        pendingBounds = null;
      }
    }

    // For touch resize, ensure edenFrame._internal.bounds is updated with final position
    if (isTouch && currentBoundsRef.current) {
      window.edenFrame!._internal.bounds = { ...currentBoundsRef.current };
      log.info(
        "Updated edenFrame._internal.bounds after touch resize:",
        window.edenFrame?._internal.bounds,
      );
    }

    // Stop global resize tracking in main process (for mouse events)
    if (!isTouch) {
      window.edenAPI.shellCommand("view/end-resize", {}).catch(log.error);
    }

    window.edenAPI.shellCommand("view/focus", {}).catch(log.error);
  };

  // Mouse events
  resizeHandle.addEventListener("mousedown", startResize);

  // Touch events
  resizeHandle.addEventListener("touchstart", startResize, { passive: false });

  // Move events for touch (mouse uses main process tracking)
  // Use document and capture to ensure we get all touch moves
  document.addEventListener("touchmove", moveResize, {
    passive: false,
    capture: true,
  });

  // Touch end/cancel events (mouseup is added dynamically when resize starts)
  document.addEventListener("touchend", endResize, { passive: false });
  document.addEventListener("touchcancel", endResize, { passive: false });

  log.info("Resize event listeners registered");

  return () => {
    if (resizeHandle.parentNode) {
      resizeHandle.parentNode.removeChild(resizeHandle);
    }

    resizeHandle.removeEventListener("mousedown", startResize);
    resizeHandle.removeEventListener("touchstart", startResize);

    document.removeEventListener("touchmove", moveResize, {
      capture: true,
    });
    document.removeEventListener("touchend", endResize);
    document.removeEventListener("touchcancel", endResize);
    window.removeEventListener("mouseup", endResize);

    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    log.info("Resize event listeners removed");
  };
}

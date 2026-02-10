import { log } from "../logging";
/**
 * Window Dragging
 *
 * Handles dragging for floating windows
 */

import { getScreenCoords } from "./utils";

/**
 * Setup window dragging for floating windows
 * @param dragSource - Event source (system overlay or document for custom drag regions)
 * @param currentBoundsRef - Reference object containing current bounds
 */
export function setupWindowDragging(
  dragSource: HTMLElement | Document,
  currentBoundsRef: {
    current: { x: number; y: number; width: number; height: number } | null;
  },
  options?: {
    dragRegionSelector?: string;
  },
): () => void {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let dragStartBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;
  let isTouch = false;
  let rafId: number | null = null;
  let pendingBounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null = null;

  const dragRegionSelector = options?.dragRegionSelector;

  // Animation frame update function - throttles IPC to 60fps
  const updatePosition = () => {
    if (pendingBounds) {
      window.edenAPI
        .shellCommand("view/update-bounds", {
          bounds: pendingBounds,
        })
        .catch(log.error);

      pendingBounds = null;
    }

    if (isDragging) {
      rafId = requestAnimationFrame(updatePosition);
    }
  };

  const startDrag = (e: MouseEvent | TouchEvent) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target) {
      return;
    }

    // In custom mode, only start drag from explicit drag regions.
    if (dragRegionSelector) {
      if (!target.closest(dragRegionSelector)) {
        return;
      }
      // Allow opt-out for interactive controls inside a drag region.
      if (target.closest("[data-eden-no-drag]")) {
        return;
      }
    } else if (target.closest(".eden-app-frame-button")) {
      // In system top bar mode, don't drag on frame buttons.
      return;
    }

    // ALWAYS refresh currentBounds at start to handle case where mouse drag updated position
    const initialBounds = window.edenFrame?._internal.bounds;
    if (initialBounds && initialBounds.x !== undefined) {
      currentBoundsRef.current = { ...initialBounds };
      log.info(currentBoundsRef.current);
    } else if (!currentBoundsRef.current) {
      log.warn("Cannot start drag - currentBounds not initialized!");
      return;
    }

    isDragging = true;
    isTouch = e.type.startsWith("touch");

    // Get screen coordinates
    const coords = getScreenCoords(e);
    startX = coords.x;
    startY = coords.y;
    dragStartBounds = { ...currentBoundsRef.current };

    // IMPORTANT: Prevent default FIRST to stop touch from being canceled
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Start animation frame loop for smooth updates
    if (isTouch) {
      rafId = requestAnimationFrame(updatePosition);
    }

    // NOTE: We do NOT call focus here anymore.
    // On macOS (and Linux touch), calling focus during drag start causes view reordering
    // which cancels the drag/touch event. Instead, we bring the window to front after drag ends.

    // For mouse events, use global tracking in main process
    // For touch events, we'll handle updates in touchmove
    if (!isTouch) {
      window.edenAPI
        .shellCommand("view/start-drag", {
          startX: coords.x,
          startY: coords.y,
        })
        .catch(log.error);
    }

    // Add mouseup listener when drag starts (removed when drag ends)
    if (!isTouch) {
      window.addEventListener("mouseup", endDrag);
    }
  };

  const moveDrag = (e: MouseEvent | TouchEvent) => {
    // Prevent default immediately
    e.preventDefault();
    e.stopPropagation();

    if (!isDragging || !dragStartBounds) {
      return;
    }

    // Get current coordinates
    const coords = getScreenCoords(e);
    const deltaX = coords.x - startX;
    const deltaY = coords.y - startY;

    const newBounds = {
      x: dragStartBounds.x + deltaX,
      y: dragStartBounds.y + deltaY,
      width: dragStartBounds.width,
      height: dragStartBounds.height,
    };

    // Update tracked bounds immediately for next move calculation
    currentBoundsRef.current = newBounds;

    // Store pending update for next animation frame
    pendingBounds = newBounds;
  };

  const endDrag = (e: MouseEvent | TouchEvent) => {
    // For touch events, only end if there are no remaining touches
    if (
      e.type.startsWith("touch") &&
      (e as TouchEvent).touches &&
      (e as TouchEvent).touches.length > 0
    ) {
      return;
    }

    if (!isDragging) {
      return;
    }

    isDragging = false;
    dragStartBounds = null;

    // Remove mouseup listener since drag is done
    window.removeEventListener("mouseup", endDrag);

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

    // For touch drag, ensure edenFrame._internal.bounds is updated with final position
    if (isTouch && currentBoundsRef.current) {
      window.edenFrame!._internal.bounds = { ...currentBoundsRef.current };
      log.info(
        "Updated edenFrame._internal.bounds after touch drag:",
        window.edenFrame?._internal.bounds,
      );
    }

    // Stop global drag tracking in main process (for mouse events)
    if (!isTouch) {
      window.edenAPI.shellCommand("view/end-drag", {}).catch(log.error);
    }

    window.edenAPI.shellCommand("view/focus", {}).catch(log.error);
  };

  // Mouse events
  dragSource.addEventListener("mousedown", startDrag as EventListener);

  // Touch events - don't use capture for start, do use for move
  dragSource.addEventListener("touchstart", startDrag as EventListener, {
    passive: false,
  });

  // Move events for touch (mouse uses main process tracking)
  // Use capture for move to ensure we get it
  document.addEventListener("touchmove", moveDrag as EventListener, {
    passive: false,
    capture: true,
  });

  // Touch end/cancel events (mouseup is added dynamically when drag starts)
  document.addEventListener("touchend", endDrag, { passive: false });
  document.addEventListener("touchcancel", endDrag, { passive: false });

  log.info("Drag event listeners registered");

  return () => {
    dragSource.removeEventListener("mousedown", startDrag as EventListener);
    dragSource.removeEventListener("touchstart", startDrag as EventListener);
    document.removeEventListener("touchmove", moveDrag as EventListener, {
      capture: true,
    });
    document.removeEventListener("touchend", endDrag);
    document.removeEventListener("touchcancel", endDrag);
    window.removeEventListener("mouseup", endDrag);

    if (rafId) {
      cancelAnimationFrame(rafId);
    }
    log.info("Drag event listeners removed");
  };
}

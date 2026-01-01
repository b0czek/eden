/**
 * Window Dragging
 *
 * Handles dragging for floating windows
 */

import { getScreenCoords } from "./utils";

/**
 * Setup window dragging for floating windows
 * @param overlay - The title bar overlay element
 * @param currentBoundsRef - Reference object containing current bounds
 */
export function setupWindowDragging(
  overlay: HTMLElement,
  currentBoundsRef: {
    current: { x: number; y: number; width: number; height: number } | null;
  }
): void {
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

  // Animation frame update function - throttles IPC to 60fps
  const updatePosition = () => {
    const appId = window.edenFrame?._internal.appId;
    if (pendingBounds && appId) {
      window.edenAPI
        .shellCommand("view/update-view-bounds", {
          appId,
          bounds: pendingBounds,
        })
        .catch(console.error);

      pendingBounds = null;
    }

    if (isDragging) {
      rafId = requestAnimationFrame(updatePosition);
    }
  };

  const startDrag = (e: MouseEvent | TouchEvent) => {
    // Only drag on the title bar itself, not on buttons
    if ((e.target as HTMLElement).closest(".eden-app-frame-button")) {
      return;
    }

    console.log("[Eden Frame] startDrag called, event type:", e.type);
    console.log(
      "[Eden Frame] currentBounds before refresh:",
      currentBoundsRef.current
    );

    // ALWAYS refresh currentBounds at start to handle case where mouse drag updated position
    const initialBounds = window.edenFrame?._internal.bounds;
    if (initialBounds && initialBounds.x !== undefined) {
      currentBoundsRef.current = { ...initialBounds };
      console.log(
        "[Eden Frame] Refreshed currentBounds from edenFrame._internal.bounds:",
        currentBoundsRef.current
      );
    } else if (!currentBoundsRef.current) {
      console.warn(
        "[Eden Frame] Cannot start drag - currentBounds not initialized!"
      );
      return;
    }

    isDragging = true;
    isTouch = e.type.startsWith("touch");

    // Get screen coordinates
    const coords = getScreenCoords(e);
    startX = coords.x;
    startY = coords.y;
    dragStartBounds = { ...currentBoundsRef.current };

    console.log("[Eden Frame] Drag started at:", coords, "isTouch:", isTouch);

    // IMPORTANT: Prevent default FIRST to stop touch from being canceled
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Start animation frame loop for smooth updates
    if (isTouch) {
      rafId = requestAnimationFrame(updatePosition);
    }

    const appId = window.edenFrame?._internal.appId;

    // Bring window to front - but ONLY for mouse events
    // For touch, calling focus-app during the touch causes view reordering which triggers touchcancel
    // Touch users need to tap elsewhere to focus, then tap title bar to drag
    if (!isTouch && appId) {
      window.edenAPI
        .shellCommand("view/focus-app", { appId })
        .catch(console.error);
    }

    // For mouse events, use global tracking in main process
    // For touch events, we'll handle updates in touchmove
    if (!isTouch && appId) {
      window.edenAPI
        .shellCommand("view/start-drag", {
          appId,
          startX: coords.x,
          startY: coords.y,
        })
        .catch(console.error);
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

    console.log(
      "[Eden Frame] Drag ended, final currentBounds:",
      currentBoundsRef.current
    );
    isDragging = false;
    dragStartBounds = null;

    // Remove mouseup listener since drag is done
    window.removeEventListener("mouseup", endDrag);

    const appId = window.edenFrame?._internal.appId;

    // Cancel animation frame and send final position
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;

      // Send final pending bounds immediately
      if (pendingBounds && appId) {
        window.edenAPI
          .shellCommand("view/update-view-bounds", {
            appId,
            bounds: pendingBounds,
          })
          .catch(console.error);

        // Update edenFrame._internal.bounds so next interaction starts from correct position
        window.edenFrame!._internal.bounds = { ...pendingBounds };
        pendingBounds = null;
      }
    }

    // For touch drag, ensure edenFrame._internal.bounds is updated with final position
    if (isTouch && currentBoundsRef.current) {
      window.edenFrame!._internal.bounds = { ...currentBoundsRef.current };
      console.log(
        "[Eden Frame] Updated edenFrame._internal.bounds after touch drag:",
        window.edenFrame?._internal.bounds
      );
    }

    // Stop global drag tracking in main process (for mouse events)
    if (!isTouch && appId) {
      window.edenAPI
        .shellCommand("view/end-drag", { appId })
        .catch(console.error);
    }
  };

  // Mouse events
  overlay.addEventListener("mousedown", startDrag);

  // Touch events - don't use capture for start, do use for move
  overlay.addEventListener("touchstart", startDrag, { passive: false });

  // Move events for touch (mouse uses main process tracking)
  // Use capture for move to ensure we get it
  document.addEventListener("touchmove", moveDrag as EventListener, {
    passive: false,
    capture: true,
  });

  // Touch end/cancel events (mouseup is added dynamically when drag starts)
  document.addEventListener("touchend", endDrag, { passive: false });
  document.addEventListener("touchcancel", endDrag, { passive: false });

  console.log("[Eden Frame] Drag event listeners registered");
}

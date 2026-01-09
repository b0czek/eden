/**
 * App Frame Utilities
 *
 * Shared utility functions for the app frame
 */

/**
 * Get screen coordinates from mouse or touch event
 * @param e - The event
 * @returns Screen coordinates
 */
export function getScreenCoords(e: MouseEvent | TouchEvent): {
  x: number;
  y: number;
} {
  // For mouse events, use screenX/screenY directly
  if ("screenX" in e && e.screenX !== undefined && e.screenY !== undefined) {
    return { x: e.screenX, y: e.screenY };
  }

  // For touch events, calculate screen coordinates from client coordinates
  if ("touches" in e && e.touches && e.touches[0]) {
    const touch = e.touches[0];
    // Try touch.screenX/screenY first (if available)
    if (touch.screenX !== undefined && touch.screenY !== undefined) {
      return { x: touch.screenX, y: touch.screenY };
    }
    // Fallback: calculate from clientX/clientY + view bounds position
    // Use currentBounds which has the actual view position
    const currentBounds = window.edenFrame?._internal.bounds;
    if (currentBounds) {
      return {
        x: currentBounds.x + touch.clientX,
        y: currentBounds.y + touch.clientY,
      };
    }
    // Last resort: use window.screenX/screenY
    return {
      x: touch.clientX + (window.screenX || 0),
      y: touch.clientY + (window.screenY || 0),
    };
  }

  return { x: 0, y: 0 };
}

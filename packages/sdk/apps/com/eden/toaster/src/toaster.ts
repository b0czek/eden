/**
 * Eden Toaster - Toast Notification Display
 *
 * Subscribes to notification events and displays toasts in the configured corner.
 * Dynamically resizes the overlay based on visible toast count.
 * Handles timeout/pause logic locally.
 */

import type { Notification, ViewBounds, WindowSize } from "@edenapp/types";

// Configuration
interface ToasterConfig {
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  toastWidth: number;
  spacing: number;
  marginX: number;
  marginY: number;
}

const CONFIG: ToasterConfig = {
  corner: "bottom-right",
  toastWidth: 320,
  spacing: 16,
  marginX: 16,
  marginY: 96,
};

interface ActiveToast extends Notification {
  element: HTMLElement;
  timeoutId: number | null;
  remainingTime: number;
  isPaused: boolean;
  isHoverPaused: boolean;
  startTime: number;
}

// Visible toasts currently displayed
const visibleToasts = new Map<string, ActiveToast>();

// Queue of pending notifications (waiting to be shown)
const pendingQueue: Notification[] = [];

let windowSize: WindowSize | null = null;

/**
 * Get current window size from Eden API
 */
async function fetchWindowSize(): Promise<WindowSize> {
  try {
    const size = await window.edenAPI.shellCommand("view/window-size", {});
    windowSize = size;
    return size;
  } catch (err) {
    console.error("Failed to get window size:", err);
    return { width: 1280, height: 800 };
  }
}

/**
 * Calculate max available height for toasts
 */
function getMaxHeight(): number {
  const ws = windowSize || { width: 1280, height: 800 };
  return ws.height - CONFIG.marginY * 2;
}

/**
 * Calculate current total height of visible toasts
 */
function getVisibleToastsHeight(): number {
  let totalHeight = 0;
  let count = 0;
  for (const toast of visibleToasts.values()) {
    totalHeight += toast.element.offsetHeight || 100;
    count++;
  }
  if (count > 1) {
    totalHeight += (count - 1) * CONFIG.spacing;
  }
  return totalHeight;
}

/**
 * Check if there's room for another toast
 */
function hasRoomForToast(estimatedHeight: number = 120): boolean {
  const currentHeight = getVisibleToastsHeight();
  const maxHeight = getMaxHeight();
  const neededHeight =
    currentHeight +
    (visibleToasts.size > 0 ? CONFIG.spacing : 0) +
    estimatedHeight;
  return neededHeight <= maxHeight;
}

/**
 * Calculate overlay bounds based on visible toast heights
 */
function calculateBounds(): ViewBounds {
  const container = document.getElementById("toast-container");

  if (visibleToasts.size === 0 || !container) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const ws = windowSize || { width: 1280, height: 800 };

  // Use container's scrollHeight to get actual content height
  const totalHeight = container.scrollHeight;

  const width = CONFIG.toastWidth;
  const height = totalHeight;

  // Calculate position based on corner
  let x: number, y: number;
  switch (CONFIG.corner) {
    case "top-left":
      x = CONFIG.marginX;
      y = CONFIG.marginY;
      break;
    case "top-right":
      x = ws.width - width - CONFIG.marginX;
      y = CONFIG.marginY;
      break;
    case "bottom-left":
      x = CONFIG.marginX;
      y = ws.height - height - CONFIG.marginY;
      break;
    case "bottom-right":
    default:
      x = ws.width - width - CONFIG.marginX;
      y = ws.height - height - CONFIG.marginY;
      break;
  }

  return { x, y, width, height };
}

/**
 * Update overlay bounds via Eden API
 */
async function updateOverlayBounds(): Promise<void> {
  const bounds = calculateBounds();
  try {
    await window.edenAPI.shellCommand("view/update-bounds", {
      bounds,
    });
  } catch (err) {
    console.error("Failed to update overlay bounds:", err);
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show next toast from the pending queue
 */
function showNextPendingToast(): void {
  if (pendingQueue.length === 0) return;
  if (!hasRoomForToast()) return;

  // Get the oldest pending notification (FIFO)
  const notification = pendingQueue.shift()!;
  displayToast(notification);
}

/**
 * Dismiss a toast locally
 */
function dismissToast(id: string): void {
  const toast = visibleToasts.get(id);
  if (!toast) return;

  // Clear timeout
  if (toast.timeoutId !== null) {
    clearTimeout(toast.timeoutId);
  }

  // Remove immediately
  toast.element.remove();
  visibleToasts.delete(id);
  updateDismissAllButton();
  updateOverlayBounds();

  // Try to show next pending toast
  showNextPendingToast();
}

/**
 * Dismiss all visible toasts and clear pending queue
 */
function dismissAllToasts(): void {
  // Clear pending queue
  pendingQueue.length = 0;

  // Dismiss all visible toasts immediately
  for (const toast of visibleToasts.values()) {
    if (toast.timeoutId !== null) {
      clearTimeout(toast.timeoutId);
    }
    toast.element.remove();
  }
  visibleToasts.clear();
  updateDismissAllButton();
  updateOverlayBounds();
}

/**
 * Show/hide the dismiss all button based on toast count
 */
function updateDismissAllButton(): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  let btn = document.getElementById("dismiss-all-btn");
  const totalCount = visibleToasts.size + pendingQueue.length;

  if (totalCount > 1) {
    // Show button
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "dismiss-all-btn";
      btn.className = "dismiss-all-btn eden-btn eden-btn-ghost";
      btn.textContent = "Dismiss All";
      btn.addEventListener("click", dismissAllToasts);
      // Prepend so it's always at the top
      container.prepend(btn);
    }
    // Update count
    btn.textContent = `Dismiss All (${totalCount})`;
  } else {
    // Hide button
    if (btn) {
      btn.remove();
    }
  }
}

/**
 * Pause toast timeout (on hover)
 */
function pauseToast(id: string): void {
  const toast = visibleToasts.get(id);
  if (!toast || toast.isHoverPaused) return;

  toast.isHoverPaused = true;

  if (!toast.isPaused) {
    doPauseToast(toast);
  }
}

/**
 * Resume toast timeout (on mouse leave)
 */
function resumeToast(id: string): void {
  const toast = visibleToasts.get(id);
  if (!toast || !toast.isHoverPaused) return;

  toast.isHoverPaused = false;

  if (toast.isPaused) {
    doResumeToast(toast);
  }
}

/**
 * Actually pause the toast timer and animation
 */
function doPauseToast(toast: ActiveToast): void {
  if (toast.isPaused) return;

  // Clear current timeout
  if (toast.timeoutId !== null) {
    clearTimeout(toast.timeoutId);
    toast.timeoutId = null;
  }

  // Calculate remaining time
  const elapsed = Date.now() - toast.startTime;
  toast.remainingTime = Math.max(0, toast.remainingTime - elapsed);
  toast.isPaused = true;

  // Pause the progress bar animation
  const progressBar = toast.element.querySelector(
    ".eden-progress-bar",
  ) as HTMLElement;
  if (progressBar) {
    progressBar.style.animationPlayState = "paused";
  }
}

/**
 * Actually resume the toast timer and animation
 */
function doResumeToast(toast: ActiveToast): void {
  if (!toast.isPaused) return;

  toast.isPaused = false;
  toast.startTime = Date.now();

  // Resume the progress bar animation
  const progressBar = toast.element.querySelector(
    ".eden-progress-bar",
  ) as HTMLElement;
  if (progressBar) {
    progressBar.style.animationPlayState = "running";
  }

  // Set new timeout with remaining time
  if (toast.remainingTime > 0) {
    toast.timeoutId = window.setTimeout(() => {
      dismissToast(toast.id);
    }, toast.remainingTime);
  } else {
    dismissToast(toast.id);
  }
}

/**
 * Create a toast element
 */
function createToastElement(notification: Notification): HTMLElement {
  const toast = document.createElement("div");
  const type = notification.type || "info";
  const isPersistent = !notification.timeout || notification.timeout <= 0;
  toast.className = `toast eden-card-glass toast-${type}${
    isPersistent ? " toast-persistent" : ""
  }`;
  toast.dataset.id = notification.id;

  // Build progress bar HTML only for non-persistent notifications
  const progressHtml = isPersistent
    ? ""
    : `
    <div class="toast-progress-container">
      <div class="eden-progress">
        <div class="eden-progress-bar" style="animation-duration: ${notification.timeout}ms;"></div>
      </div>
    </div>
  `;

  toast.innerHTML = `
    <div class="toast-inner">
      <div class="toast-content">
        <div class="toast-title">${escapeHtml(notification.title)}</div>
        <div class="toast-message">${escapeHtml(notification.message)}</div>
      </div>
      <button class="toast-dismiss" aria-label="Dismiss">×</button>
    </div>
    ${progressHtml}
  `;

  // Handle dismiss click
  const dismissBtn = toast.querySelector(".toast-dismiss");
  dismissBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    dismissToast(notification.id);
  });

  // Pause on hover (only for non-persistent)
  if (!isPersistent) {
    toast.addEventListener("mouseenter", () => {
      pauseToast(notification.id);
    });

    // Resume on mouse leave
    toast.addEventListener("mouseleave", () => {
      resumeToast(notification.id);
    });
  }

  return toast;
}

/**
 * Display a toast (actually render it)
 */
function displayToast(notification: Notification): void {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const element = createToastElement(notification);

  // Always append at the end - oldest at bottom, newest at top
  container.appendChild(element);

  const isPersistent = !notification.timeout || notification.timeout <= 0;

  // Set up timeout only for non-persistent notifications
  let timeoutId: number | null = null;
  if (!isPersistent) {
    timeoutId = window.setTimeout(() => {
      dismissToast(notification.id);
    }, notification.timeout);
  }

  const toast: ActiveToast = {
    ...notification,
    element,
    timeoutId,
    remainingTime: notification.timeout ?? 0,
    isPaused: false,
    isHoverPaused: false,
    startTime: Date.now(),
  };

  visibleToasts.set(notification.id, toast);

  // Update dismiss all button and bounds
  updateDismissAllButton();
  updateOverlayBounds();
}

/**
 * Handle new toast notification
 */
function handleToastAdded(data: { notification: Notification }): void {
  const { notification } = data;

  if (hasRoomForToast()) {
    // Show immediately
    displayToast(notification);
  } else {
    // Add to pending queue (will be shown when space is available)
    pendingQueue.push(notification);
    updateDismissAllButton();
    console.log(
      `Toast queued: ${notification.id} (${pendingQueue.length} pending)`,
    );
  }
}

/**
 * Initialize the toaster
 */
async function init(): Promise<void> {
  console.log("Eden Toaster initializing...");

  // Fetch initial window size
  await fetchWindowSize();

  // Subscribe to notification events
  window.edenAPI.subscribe("notification/added", handleToastAdded);

  // Subscribe to window size changes
  window.edenAPI.subscribe(
    "view/global-bounds-changed",
    (data: { windowSize: WindowSize }) => {
      windowSize = data.windowSize;
      updateOverlayBounds();
    },
  );

  // Initial bounds (0x0)
  await updateOverlayBounds();

  console.log("Eden Toaster ready!");
}

// Start
init();

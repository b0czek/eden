/**
 * Eden Toaster - Toast Notification Display
 *
 * Subscribes to notification events and displays toasts in the configured corner.
 * Dynamically resizes the overlay based on visible toast count.
 */

import type { WindowSize, ViewBounds, Notification } from "@edenapp/types";

// Configuration
interface ToasterConfig {
  corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  toastWidth: number;
  toastHeight: number;
  spacing: number;
  margin: number;
  animationDuration: number;
}

const CONFIG: ToasterConfig = {
  corner: "bottom-right",
  toastWidth: 320,
  toastHeight: 90,
  spacing: 16,
  margin: 80,
  animationDuration: 300,
};

interface ActiveToast extends Notification {
  element: HTMLElement;
}

const activeToasts = new Map<string, ActiveToast>();

let windowSize: WindowSize | null = null;

/**
 * Get current window size from Eden API
 */
async function fetchWindowSize(): Promise<WindowSize> {
  try {
    const size = await window.edenAPI!.shellCommand("view/window-size", {});
    windowSize = size;
    return size;
  } catch (err) {
    console.error("Failed to get window size:", err);
    return { width: 1280, height: 800 };
  }
}

/**
 * Calculate overlay bounds based on toast count
 */
function calculateBounds(): ViewBounds {
  const count = activeToasts.size;

  if (count === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const ws = windowSize || { width: 1280, height: 800 };

  // Calculate total height needed
  const totalHeight = count * CONFIG.toastHeight + (count - 1) * CONFIG.spacing;

  // Clip to window size (minus margins)
  const maxHeight = ws.height - CONFIG.margin * 2;
  const clippedHeight = Math.min(totalHeight, maxHeight);

  const width = CONFIG.toastWidth;
  const height = clippedHeight;

  // Calculate position based on corner
  let x: number, y: number;
  switch (CONFIG.corner) {
    case "top-left":
      x = CONFIG.margin;
      y = CONFIG.margin;
      break;
    case "top-right":
      x = ws.width - width - CONFIG.margin;
      y = CONFIG.margin;
      break;
    case "bottom-left":
      x = CONFIG.margin;
      y = ws.height - height - CONFIG.margin;
      break;
    case "bottom-right":
    default:
      x = ws.width - width - CONFIG.margin;
      y = ws.height - height - CONFIG.margin;
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
    await window.edenAPI!.shellCommand("view/update-view-bounds", {
      appId: "com.eden.toaster",
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
 * Create a toast element
 */
function createToastElement(notification: Notification): HTMLElement {
  const toast = document.createElement("div");
  toast.className = "toast eden-card eden-card-glass";
  toast.dataset.id = notification.id;

  toast.innerHTML = `
    <div class="toast-inner">
      <div class="toast-indicator"></div>
      <div class="toast-content">
        <div class="toast-title">${escapeHtml(notification.title)}</div>
        <div class="toast-message">${escapeHtml(notification.message)}</div>
      </div>
      <button class="toast-dismiss" aria-label="Dismiss">×</button>
    </div>
  `;

  // Handle dismiss click
  const dismissBtn = toast.querySelector(".toast-dismiss");
  dismissBtn?.addEventListener("click", () => {
    dismissToast(notification.id);
  });

  return toast;
}

/**
 * Dismiss toast via API
 */
async function dismissToast(id: string): Promise<void> {
  try {
    await window.edenAPI!.shellCommand("notification/dismiss", { id });
  } catch (err) {
    console.error("Failed to dismiss toast:", err);
  }
}

/**
 * Handle new toast notification
 */
function handleToastAdded(data: { notification: Notification }): void {
  const { notification } = data;
  const container = document.getElementById("toast-container");
  if (!container) return;

  const element = createToastElement(notification);
  container.appendChild(element);

  // Trigger entrance animation
  requestAnimationFrame(() => {
    element.classList.add("toast-visible");
  });

  activeToasts.set(notification.id, {
    ...notification,
    element,
  });

  updateOverlayBounds();
}

/**
 * Handle toast removal
 */
function handleToastRemoved(data: { id: string }): void {
  const { id } = data;
  const toast = activeToasts.get(id);
  if (!toast) return;

  // Trigger exit animation
  toast.element.classList.remove("toast-visible");
  toast.element.classList.add("toast-exit");

  // Remove after animation
  setTimeout(() => {
    toast.element.remove();
    activeToasts.delete(id);
    updateOverlayBounds();
  }, CONFIG.animationDuration);
}

/**
 * Initialize the toaster
 */
async function init(): Promise<void> {
  console.log("Eden Toaster initializing...");

  // Fetch initial window size
  await fetchWindowSize();

  // Subscribe to notification events
  window.edenAPI!.subscribe("notification/added", handleToastAdded);
  window.edenAPI!.subscribe("notification/removed", handleToastRemoved);

  // Subscribe to window size changes
  window.edenAPI!.subscribe(
    "view/global-bounds-changed",
    (data: { windowSize: WindowSize }) => {
      windowSize = data.windowSize;
      updateOverlayBounds();
    }
  );

  // Initial bounds (0x0)
  await updateOverlayBounds();

  console.log("Eden Toaster ready!");
}

// Start
init();

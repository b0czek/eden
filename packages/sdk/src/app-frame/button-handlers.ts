import { log } from "../logging";
/**
 * App Frame Button Handlers
 *
 * Shared actions + event handlers for frame control buttons.
 */

export async function closeAppFrameView(): Promise<void> {
  await window.edenAPI.shellCommand("process/exit", {});
}

export async function minimizeAppFrameView(): Promise<void> {
  await window.edenAPI.shellCommand("view/set-visibility", {
    visible: false,
  });
}

export async function toggleAppFrameViewMode(): Promise<void> {
  await window.edenAPI.shellCommand("view/toggle-mode", {});
  log.info("View mode toggled");
}

/**
 * Setup close button handler
 */
export function setupCloseButton(): void {
  const closeBtn = document.getElementById("eden-close-btn");
  if (!closeBtn) return;

  closeBtn.addEventListener("click", () => {
    closeAppFrameView().catch(log.error);
  });
}

/**
 * Setup minimize button handler
 */
export function setupMinimizeButton(): void {
  const minBtn = document.getElementById("eden-minimize-btn");
  if (!minBtn) return;

  minBtn.addEventListener("click", () => {
    minimizeAppFrameView().catch(log.error);
  });
}

/**
 * Setup toggle mode button handler (for apps that support both tiled and floating)
 */
export function setupToggleModeButton(): void {
  const toggleBtn = document.getElementById("eden-toggle-mode-btn");
  if (!toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    toggleAppFrameViewMode().catch(log.error);
  });
}

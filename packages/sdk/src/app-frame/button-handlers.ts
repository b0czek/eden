import * as eden from "@edenapp/client";
import { log } from "../logging/logger";
/**
 * App Frame Button Handlers
 *
 * Shared actions + event handlers for frame control buttons.
 */

export async function closeAppFrameView(): Promise<void> {
  // The close action completes when Eden accepts teardown of this caller.
  await eden.process.exit();
}

export async function minimizeAppFrameView(): Promise<void> {
  await eden.view.setVisibility(false);
}

export async function toggleAppFrameViewMode(): Promise<void> {
  await eden.view.toggleMode();
}

/**
 * Setup close button handler
 */
export function setupCloseButton(): void {
  const closeBtn = document.getElementById("eden-close-btn");
  if (!closeBtn) return;

  closeBtn.addEventListener("click", () => {
    window.edenFrame?.close().catch(log.error);
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

import { log } from "../logging";
import type { PlatformView } from "../platform/ports";
/**
 * DevToolsController
 *
 * Manages DevTools for WebContentsViews, including:
 * - Keyboard shortcut registration (Ctrl+Shift+D)
 * - Automatic cleanup when views are destroyed
 */
export class DevToolsController {
  private viewsWithDevTools: Set<number> = new Set();

  /**
   * Register DevTools shortcut (Ctrl+Shift+D) on a WebContentsView
   * Works on both X11 and Wayland
   */
  registerShortcut(view: PlatformView): void {
    view.webContents.on(
      "before-input-event",
      (
        event: { preventDefault(): void },
        input: {
          type: string;
          key: string;
          shift: boolean;
          control: boolean;
          meta: boolean;
          alt: boolean;
        },
      ) => {
        // Check for Ctrl+Shift+D (or Cmd+Shift+D on macOS)
        if (
          input.type === "keyDown" &&
          input.key.toLowerCase() === "d" &&
          input.shift &&
          (input.control || input.meta) &&
          !input.alt
        ) {
          event.preventDefault();
          try {
            const webContentsId = view.webContents.id;

            if (view.webContents.isDevToolsOpened()) {
              view.webContents.closeDevTools();
              this.viewsWithDevTools.delete(webContentsId);
              log.info("Closed DevTools for view");
            } else {
              view.webContents.openDevTools();
              this.viewsWithDevTools.add(webContentsId);
              log.info("Opened DevTools for view");
            }
          } catch (err) {
            log.error("Failed to toggle DevTools:", err);
          }
        }
      },
    );
  }

  /**
   * Close DevTools for a view when it's being destroyed
   */
  closeDevToolsForView(view: PlatformView): void {
    try {
      const webContentsId = view.webContents.id;

      if (
        !view.webContents.isDestroyed() &&
        view.webContents.isDevToolsOpened()
      ) {
        view.webContents.closeDevTools();
        log.info(`Closed DevTools for view (webContents ID: ${webContentsId})`);
      }

      this.viewsWithDevTools.delete(webContentsId);
    } catch (err) {
      // Ignore errors during cleanup
      log.debug("Error closing DevTools during cleanup:", err);
    }
  }

  /**
   * Get the set of webContents IDs that have DevTools open
   */
  getViewsWithDevTools(): Set<number> {
    return new Set(this.viewsWithDevTools);
  }

  /**
   * Clear all tracked DevTools
   */
  clear(): void {
    this.viewsWithDevTools.clear();
  }
}

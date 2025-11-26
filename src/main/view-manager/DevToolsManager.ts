import { WebContentsView } from "electron";

/**
 * DevToolsManager
 * 
 * Manages DevTools for WebContentsViews, including:
 * - Keyboard shortcut registration (Ctrl+Shift+D)
 * - Automatic cleanup when views are destroyed
 */
export class DevToolsManager {
  private viewsWithDevTools: Set<number> = new Set();

  /**
   * Register DevTools shortcut (Ctrl+Shift+D) on a WebContentsView
   * Works on both X11 and Wayland
   */
  registerShortcut(view: WebContentsView): void {
    view.webContents.on("before-input-event", (event, input) => {
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
            console.log("Closed DevTools for view");
          } else {
            view.webContents.openDevTools();
            this.viewsWithDevTools.add(webContentsId);
            console.log("Opened DevTools for view");
          }
        } catch (err) {
          console.error("Failed to toggle DevTools:", err);
        }
      }
    });
  }

  /**
   * Close DevTools for a view when it's being destroyed
   */
  closeDevToolsForView(view: WebContentsView): void {
    try {
      const webContentsId = view.webContents.id;
      
      if (!view.webContents.isDestroyed() && view.webContents.isDevToolsOpened()) {
        view.webContents.closeDevTools();
        console.log(`Closed DevTools for view (webContents ID: ${webContentsId})`);
      }
      
      this.viewsWithDevTools.delete(webContentsId);
    } catch (err) {
      // Ignore errors during cleanup
      console.debug("Error closing DevTools during cleanup:", err);
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

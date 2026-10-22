import { log } from "../../platform/logging/logger";
import type { PlatformView } from "../../platform/ports/types";
export function createViewDevTools() {
  const _viewsWithDevTools: Set<number> = new Set();

  function registerShortcut(view: PlatformView): void {
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
              _viewsWithDevTools.delete(webContentsId);
              log.info("Closed DevTools for view");
            } else {
              view.webContents.openDevTools();
              _viewsWithDevTools.add(webContentsId);
              log.info("Opened DevTools for view");
            }
          } catch (err) {
            log.error("Failed to toggle DevTools:", err);
          }
        }
      },
    );
  }

  function closeDevToolsForView(view: PlatformView): void {
    try {
      const webContentsId = view.webContents.id;

      if (
        !view.webContents.isDestroyed() &&
        view.webContents.isDevToolsOpened()
      ) {
        view.webContents.closeDevTools();
        log.info(`Closed DevTools for view (webContents ID: ${webContentsId})`);
      }

      _viewsWithDevTools.delete(webContentsId);
    } catch (err) {
      // Ignore errors during cleanup
      log.debug("Error closing DevTools during cleanup:", err);
    }
  }

  function getViewsWithDevTools(): Set<number> {
    return new Set(_viewsWithDevTools);
  }

  function clear(): void {
    _viewsWithDevTools.clear();
  }
  return {
    registerShortcut,
    closeDevToolsForView,
    getViewsWithDevTools,
    clear,
  };
}

export type ViewDevTools = ReturnType<typeof createViewDevTools>;

/**
 * App Frame Button Handlers
 *
 * Event handlers for frame control buttons (close, minimize, toggle mode)
 */

/**
 * Setup close button handler
 */
export function setupCloseButton(): void {
  const closeBtn = document.getElementById("eden-close-btn");
  if (!closeBtn) return;

  closeBtn.addEventListener("click", () => {
    // Wait for edenFrame to be available
    const stopApp = () => {
      const appId = window.edenFrame?._internal.appId;
      console.log("[Eden Frame] Stopping app:", appId);

      if (appId) {
        window.edenAPI
          .shellCommand("process/stop", { appId })
          .catch(console.error);
      } else {
        // Retry if API or appId not yet available
        setTimeout(stopApp, 100);
      }
    };
    stopApp();
  });
}

/**
 * Setup minimize button handler
 */
export function setupMinimizeButton(): void {
  const minBtn = document.getElementById("eden-minimize-btn");
  if (!minBtn) return;

  minBtn.addEventListener("click", () => {
    const minimize = () => {
      const appId = window.edenFrame?._internal.appId;

      if (appId) {
        window.edenAPI
          .shellCommand("view/set-view-visibility", {
            appId,
            visible: false,
          })
          .catch(console.error);
      } else {
        setTimeout(minimize, 100);
      }
    };
    minimize();
  });
}

/**
 * Setup toggle mode button handler (for apps that support both tiled and floating)
 */
export function setupToggleModeButton(): void {
  const toggleBtn = document.getElementById("eden-toggle-mode-btn");
  if (!toggleBtn) return;

  toggleBtn.addEventListener("click", () => {
    const toggleMode = () => {
      const appId = window.edenFrame?._internal.appId;

      if (appId) {
        window.edenAPI
          .shellCommand("view/toggle-view-mode", {
            appId,
          })
          .then(() => {
            console.log("[Eden Frame] View mode toggled");
          })
          .catch(console.error);
      } else {
        setTimeout(toggleMode, 100);
      }
    };
    toggleMode();
  });
}

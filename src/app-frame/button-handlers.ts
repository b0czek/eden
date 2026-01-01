/**
 * App Frame Button Handlers
 *
 * Event handlers for frame control buttons (close, minimize, toggle mode)
 */

/**
 * Attaches a click handler to the element with ID "eden-close-btn" that stops the current app.
 *
 * When clicked, the handler obtains the appId from window.edenFrame._internal.appId and calls edenAPI.shellCommand("process/stop", { appId }). If the button is not present the function does nothing. If appId is not yet available, the handler retries until an appId is found.
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
 * Attaches a click handler to the minimize frame button that hides the app view.
 *
 * When clicked, the handler obtains the appId from `window.edenFrame?._internal.appId` and invokes
 * `edenAPI.shellCommand("view/set-view-visibility", { appId, visible: false })`. If the `appId`
 * is not yet available, the handler retries until it is.
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
 * Attach a click handler to the toggle-mode button that requests the current app's view mode to toggle.
 *
 * Invokes `view/toggle-view-mode` via `window.edenAPI.shellCommand` using the appId from `window.edenFrame?._internal.appId`.
 * If the appId is not yet available, the request is retried until an appId is present. Successful toggles and errors are logged to the console.
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
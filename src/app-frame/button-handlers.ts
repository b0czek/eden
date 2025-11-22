/**
 * App Frame Button Handlers
 * 
 * Event handlers for frame control buttons (close, minimize, toggle mode)
 */

/**
 * Setup close button handler
 * @param appId - The app ID
 */
export function setupCloseButton(appId: string | null): void {
    const closeBtn = document.getElementById('eden-close-btn');
    if (!closeBtn) return;

    closeBtn.addEventListener('click', () => {
        // Wait for edenAPI to be available
        const stopApp = () => {
            if (window.edenAPI && appId) {
                window.edenAPI.shellCommand('app/stop', { appId }).catch(console.error);
            } else {
                setTimeout(stopApp, 100);
            }
        };
        stopApp();
    });
}

/**
 * Setup minimize button handler
 * @param appId - The app ID
 */
export function setupMinimizeButton(appId: string | null): void {
    const minBtn = document.getElementById('eden-minimize-btn');
    if (!minBtn) return;

    minBtn.addEventListener('click', () => {
        const minimize = () => {
            if (window.edenAPI && appId) {
                window.edenAPI.shellCommand('app/set-view-visibility', {
                    appId,
                    visible: false
                }).catch(console.error);
            } else {
                setTimeout(minimize, 100);
            }
        };
        minimize();
    });
}

/**
 * Setup toggle mode button handler (for apps that support both tiled and floating)
 * @param appId - The app ID
 */
export function setupToggleModeButton(appId: string | null): void {
    const toggleBtn = document.getElementById('eden-toggle-mode-btn');
    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        const toggleMode = () => {
            if (window.edenAPI && appId) {
                window.edenAPI.shellCommand('app/toggle-view-mode', {
                    appId
                }).then(() => {
                    console.log('[Eden Frame] View mode toggled');
                }).catch(console.error);
            } else {
                setTimeout(toggleMode, 100);
            }
        };
        toggleMode();
    });
}

/**
 * App Frame UI Builder
 * 
 * Functions for creating and managing the app frame overlay UI
 */

/**
 * Create the app frame overlay element
 * @param windowConfig - Window configuration from manifest
 * @returns The overlay element
 */
export function createOverlay(windowConfig: NonNullable<Window['edenFrame']>['_internal']['config']): HTMLElement {
    const overlay = document.createElement('div');
    overlay.id = 'eden-app-frame-overlay';

    const supportsToggle = windowConfig.mode === 'both';
    const showTitle = windowConfig.showTitle !== false; // Default to true if not specified

    // Create toggle button HTML if supported
    const toggleButtonHtml = supportsToggle
        ? `<button class="eden-app-frame-button toggle-mode" id="eden-toggle-mode-btn" title="Toggle Window Mode">⊞</button>`
        : '';

    // Create title HTML if showTitle is true
    const titleHtml = showTitle
        ? `<div id="eden-app-frame-title">App</div>`
        : '';

    overlay.innerHTML = `
    ${titleHtml}
    <div id="eden-app-frame-controls">
      ${toggleButtonHtml}
      <button class="eden-app-frame-button minimize" id="eden-minimize-btn" title="Minimize">−</button>
      <button class="eden-app-frame-button close" id="eden-close-btn" title="Close">×</button>
    </div>
  `;

    return overlay;
}

/**
 * Inject the overlay into the DOM when ready
 * @param overlay - The overlay element to inject
 * @param callback - Called after injection
 */
export function injectOverlay(overlay: HTMLElement, callback?: () => void): void {
    const inject = () => {
        console.log('[Eden Frame] injectOverlay called, body exists:', !!document.body);
        if (document.body) {
            document.body.insertBefore(overlay, document.body.firstChild);
            document.body.classList.add('eden-framed');
            console.log('[Eden Frame] Overlay injected into body');

            if (callback) {
                callback();
            }
        } else {
            console.log('[Eden Frame] Body not ready, retrying...');
            setTimeout(inject, 10);
        }
    };

    // Inject when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
}

/**
 * Setup dark mode detection and updates
 * @param overlay - The overlay element
 */
export function setupDarkMode(overlay: HTMLElement): void {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

    const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
        if (e.matches) {
            overlay.classList.add('dark');
        } else {
            overlay.classList.remove('dark');
        }
    };

    updateTheme(prefersDark);
    prefersDark.addEventListener('change', updateTheme);
}

/**
 * Set the title bar text
 * @param title - The title to display
 */
export function setTitle(title: string): void {
    const titleEl = document.getElementById('eden-app-frame-title');
    if (titleEl) {
        titleEl.textContent = title;
    }
}

/**
 * Extract a readable name from app ID
 * @param appId - The app ID (e.g., 'com.example.myapp')
 * @returns Readable name (e.g., 'Myapp')
 */
export function getAppName(appId: string): string {
    const parts = appId.split('.');
    const name = parts[parts.length - 1] || appId;
    // Capitalize first letter
    return name.charAt(0).toUpperCase() + name.slice(1);
}

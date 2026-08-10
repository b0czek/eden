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
export function createOverlay(
  windowConfig: NonNullable<Window["edenFrame"]>["_internal"]["config"],
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.id = "eden-app-frame-overlay";

  const supportsToggle = windowConfig.mode === "both";
  const showTitle = windowConfig.showTitle !== false; // Default to true if not specified
  const showMinimize = windowConfig.showMinimize !== false; // Default to true if not specified

  // Create toggle button HTML if supported
  const toggleButtonHtml = supportsToggle
    ? `<button class="eden-app-frame-button toggle-mode" id="eden-toggle-mode-btn" title="Toggle Window Mode">⊞</button>`
    : "";

  // Create title HTML if showTitle is true
  const titleHtml = showTitle
    ? `<div id="eden-app-frame-title">
        <span id="eden-app-frame-title-text">App</span>
        <svg class="eden-app-frame-title-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m5 6 3 3 3-3" />
        </svg>
      </div>
      <div id="eden-tile-layout-compass" role="dialog" aria-modal="false" hidden>
        <div class="eden-tile-layout-heading">
          <span id="eden-tile-layout-heading-text">Arrange window</span>
        </div>
        <div class="eden-tile-layout-map">
          ${createCompassEdge("top")}
          ${createCompassEdge("right")}
          ${createCompassEdge("bottom")}
          ${createCompassEdge("left")}
          <div class="eden-tile-layout-window">
            <svg viewBox="0 0 72 52" aria-hidden="true">
              <rect class="eden-tile-layout-window-body" x="1" y="1" width="70" height="50" rx="10" />
              <path class="eden-tile-layout-window-bar" d="M2 13.5h68" />
              <circle cx="62" cy="7.5" r="1.5" />
              <circle cx="57" cy="7.5" r="1.5" />
            </svg>
          </div>
        </div>
      </div>`
    : "";

  const minimizeButtonHtml = showMinimize
    ? `<button class="eden-app-frame-button minimize" id="eden-minimize-btn" title="Minimize">−</button>`
    : "";

  overlay.innerHTML = `
    ${titleHtml}
    <div id="eden-app-frame-controls">
      ${toggleButtonHtml}
      ${minimizeButtonHtml}
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
export function injectOverlay(
  overlay: HTMLElement,
  callback?: () => void,
): void {
  const inject = () => {
    if (document.body) {
      document.body.insertBefore(overlay, document.body.firstChild);
      document.body.classList.add("eden-framed");

      if (callback) {
        callback();
      }
    } else {
      setTimeout(inject, 10);
    }
  };

  // Inject when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", inject);
  } else {
    inject();
  }
}

/**
 * Setup dark mode detection and updates
 * @param overlay - The overlay element
 */
export function setupDarkMode(overlay: HTMLElement): void {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  const updateTheme = (e: MediaQueryListEvent | MediaQueryList) => {
    if (e.matches) {
      overlay.classList.add("dark");
    } else {
      overlay.classList.remove("dark");
    }
  };

  updateTheme(prefersDark);
  prefersDark.addEventListener("change", updateTheme);
}

/**
 * Set the title bar text
 * @param title - The title to display
 */
export function setTitle(title: string): void {
  const titleEl = document.getElementById("eden-app-frame-title-text");
  if (titleEl) {
    titleEl.textContent = title;
  }
}

type CompassDirection = "top" | "right" | "bottom" | "left";

function createCompassEdge(direction: CompassDirection): string {
  return `<div class="eden-tile-layout-edge eden-tile-layout-edge-${direction}" data-layout-direction="${direction}">
    <button type="button" data-layout-action="expand" disabled>
      ${expandIcon()}
    </button>
    <button type="button" data-layout-action="swap" disabled>
      ${swapIcon()}
    </button>
  </div>`;
}

function expandIcon(): string {
  return compassIcon("M5 12h12m-4-4 4 4-4 4M19 5v14");
}

function swapIcon(): string {
  return compassIcon("M6 7h12m-3-3 3 3-3 3M18 17H6m3-3-3 3 3 3");
}

function compassIcon(path: string): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}" /></svg>`;
}

/**
 * Extract a readable name from app ID
 * @param name - The app name (string or localized object)
 * @param locale - The locale to use (default 'en')
 * @returns Readable name
 */
export function getAppName(
  name: string | Record<string, string>,
  locale: string = "en",
): string {
  if (typeof name === "string") {
    const parts = name.split(".");
    const readable = parts[parts.length - 1] || name;
    return readable.charAt(0).toUpperCase() + readable.slice(1);
  }

  const language = locale.split("-")[0];
  return (
    name[locale] || name[language] || name.en || Object.values(name)[0] || "App"
  );
}

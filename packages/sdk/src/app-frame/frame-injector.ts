import { log } from "../logging";

/**
 * Eden App Frame Injector
 *
 * Main orchestrator for the app frame system.
 * This script is injected into app views to apply frame runtime behavior.
 */

import {
  closeAppFrameView,
  minimizeAppFrameView,
  setupCloseButton,
  setupMinimizeButton,
  setupToggleModeButton,
  toggleAppFrameViewMode,
} from "./button-handlers.js";
import {
  createOverlay,
  getAppName,
  injectOverlay,
  setTitle,
  setupDarkMode,
} from "./ui-builder.js";
import { setupWindowDragging } from "./window-dragging.js";
import { setupWindowResizing } from "./window-resizing.js";

(() => {
  log.info("Injection script started");

  // Initialize edenFrame object if not exists
  if (!window.edenFrame) {
    window.edenFrame = {
      setTitle: (title: string) => {
        /* will be set later */
      },
      resetTitle: () => {
        /* will be set later */
      },
      close: async () => {
        /* will be set later */
      },
      minimize: async () => {
        /* will be set later */
      },
      toggleMode: async () => {
        /* will be set later */
      },
      _internal: {
        appId: "",
        appName: "" as string | Record<string, string>,
        injected: false,
        config: {},
        currentMode: "tiled",
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    };
  }
  if (!window.edenFrame.setTitle) {
    window.edenFrame.setTitle = () => {
      /* no-op until initialized */
    };
  }
  if (!window.edenFrame.resetTitle) {
    window.edenFrame.resetTitle = () => {
      /* no-op until initialized */
    };
  }
  if (!window.edenFrame.close) {
    window.edenFrame.close = async () => {
      /* no-op until initialized */
    };
  }
  if (!window.edenFrame.minimize) {
    window.edenFrame.minimize = async () => {
      /* no-op until initialized */
    };
  }
  if (!window.edenFrame.toggleMode) {
    window.edenFrame.toggleMode = async () => {
      /* no-op until initialized */
    };
  }

  // Check if already injected
  if (window.edenFrame._internal.injected) {
    log.info("Already injected, skipping");
    return;
  }
  window.edenFrame._internal.injected = true;

  let appName: string = "App";

  // Track current window bounds for floating windows
  // Using an object reference so we can update it and have the change reflected in all modules
  const currentBoundsRef: {
    current: { x: number; y: number; width: number; height: number } | null;
  } = { current: null };

  let cleanupDrag: (() => void) | null = null;
  let cleanupResize: (() => void) | null = null;

  const configuredAppFrameMode =
    window.edenFrame._internal.config.injections?.appFrame;
  const appFrameMode =
    configuredAppFrameMode === "window-only" ? "window-only" : "full";
  const includeSystemTopBar = appFrameMode === "full";

  // Only create the Eden title bar in full mode.
  const overlay = includeSystemTopBar
    ? createOverlay(window.edenFrame._internal.config)
    : null;

  // Setup handlers after overlay is injected
  const setupHandlers = (): void => {
    // Get appId from injected config
    if (window.edenFrame) {
      const rawName = window.edenFrame._internal.appName;
      appName = getAppName(rawName, "en");

      if (includeSystemTopBar) {
        // Async fetch locale for title text
        window.edenAPI
          .shellCommand("i18n/get-locale", {})
          .then((response: { locale: string }) => {
            const locale = response?.locale;
            const currentLocale = locale || "en";
            appName = getAppName(rawName, currentLocale);
            setTitle(appName);
          })
          .catch(() => {
            appName = getAppName(rawName, "en");
            setTitle(appName);
          });

        // Set initial title (english fallback) to avoid empty title while fetching
        setTitle(appName);

        // Subscribe to locale changes for live updates
        window.edenAPI.subscribe(
          "i18n/locale-changed",
          (data: { locale: string }) => {
            const newLocale = data.locale;
            const currentName = getAppName(rawName, newLocale);
            setTitle(currentName);
            appName = currentName;
          },
        );
      }
    }

    if (includeSystemTopBar) {
      // Setup system top bar button handlers
      setupCloseButton();
      setupMinimizeButton();
      setupToggleModeButton();
    }

    // Setup floating window controls
    setupFloatingWindowControls();

    window.edenAPI.subscribe(
      "view/mode-changed",
      (data: { mode: "tiled" | "floating"; bounds: any }) => {
        const { mode, bounds } = data;
        log.info("View mode changed to:", mode, "with bounds:", bounds);

        // Update window mode and bounds
        window.edenFrame!._internal.currentMode = mode;
        if (bounds && bounds.x !== undefined) {
          window.edenFrame!._internal.bounds = bounds;
          currentBoundsRef.current = { ...bounds };
        }

        // Re-setup controls for new mode
        setupFloatingWindowControls();
      },
    );
    log.info("Subscribed to view/mode-changed");
  };

  const setupFloatingWindowControls = (): void => {
    const windowMode = window.edenFrame!._internal.currentMode;
    const windowConfig = window.edenFrame!._internal.config;
    const initialBounds = window.edenFrame!._internal.bounds;

    log.info("Window mode:", initialBounds);

    // Clean up previous controls if they exist (crucial for mode switching)
    if (cleanupDrag) {
      cleanupDrag();
      cleanupDrag = null;
    }
    if (cleanupResize) {
      cleanupResize();
      cleanupResize = null;
    }

    // Only enable dragging/resizing for floating windows
    if (windowMode !== "floating") {
      // If we are not floating, we just returned after cleanup, so handles are gone.
      return;
    }

    // Initialize current bounds from the actual bounds set by ViewManager
    if (initialBounds && initialBounds.x !== undefined) {
      currentBoundsRef.current = { ...initialBounds };
      log.info("Initialized bounds from backend:", currentBoundsRef.current);
    } else if (windowConfig.defaultSize) {
      // Fallback to config if no initial bounds provided
      const workspaceX = 0;
      const workspaceY = 0;

      const x = windowConfig.defaultPosition?.x || 0;
      const y = windowConfig.defaultPosition?.y || 0;

      currentBoundsRef.current = {
        x: workspaceX + x,
        y: workspaceY + y,
        width: windowConfig.defaultSize.width || 800,
        height: windowConfig.defaultSize.height || 600,
      };

      log.info("Initialized bounds from config:", currentBoundsRef.current);
    }

    // Check if dragging is allowed
    const isMovable = windowConfig.movable !== false; // default true
    const isResizable = windowConfig.resizable !== false; // default true

    log.info("Movable:", isMovable, "Resizable:", isResizable);

    // Setup window dragging
    if (isMovable) {
      if (overlay) {
        cleanupDrag = setupWindowDragging(overlay, currentBoundsRef);
      } else {
        cleanupDrag = setupWindowDragging(document, currentBoundsRef, {
          dragRegionSelector: "[data-eden-drag-region]",
        });
      }
    }

    // Setup window resizing
    if (isResizable) {
      cleanupResize = setupWindowResizing(windowConfig, currentBoundsRef);
    }
  };

  // Listen for bounds updates from main process (during mouse drag/resize)
  // This keeps currentBounds in sync even when main process is controlling movement
  window.edenAPI.subscribe("view/bounds-updated", (newBounds) => {
    currentBoundsRef.current = { ...newBounds };
    window.edenFrame!._internal.bounds = { ...newBounds };
  });
  log.info("Subscribed to view/bounds-updated");

  // Add global touch handler to diagnose issues
  document.addEventListener(
    "touchstart",
    (e) => {
      log.info("Global touchstart on:", e.target);
    },
    { passive: false, capture: true },
  );

  document.addEventListener(
    "touchcancel",
    (e) => {
      log.info("Global touchcancel on:", e.target);
      log.info("Stack trace:", new Error().stack);
    },
    { capture: true },
  );

  // Inject overlay and setup handlers
  if (overlay) {
    injectOverlay(overlay, () => {
      setupDarkMode(overlay);
      setupHandlers();
    });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupHandlers);
  } else {
    setupHandlers();
  }

  // Expose API for apps to update the title
  window.edenFrame.setTitle = (title: string) => {
    setTitle(title);
  };

  // Expose resetTitle immediately (using English/default name initially)
  window.edenFrame.resetTitle = () => {
    setTitle(appName);
  };

  // Expose app frame actions for custom title bars.
  window.edenFrame.close = () => closeAppFrameView();
  window.edenFrame.minimize = () => minimizeAppFrameView();
  window.edenFrame.toggleMode = () => toggleAppFrameViewMode();
})();

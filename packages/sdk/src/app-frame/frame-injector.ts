import { log } from "../logging";
/**
 * Eden App Frame Injector
 *
 * Main orchestrator for the app frame system.
 * This script is injected into every app to add a title bar with controls.
 */

import {
  createOverlay,
  injectOverlay,
  setupDarkMode,
  setTitle,
  getAppName,
} from "./ui-builder.js";
import {
  setupCloseButton,
  setupMinimizeButton,
  setupToggleModeButton,
} from "./button-handlers.js";
import { setupWindowDragging } from "./window-dragging.js";
import { setupWindowResizing } from "./window-resizing.js";

(function () {
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

  // Check if already injected
  if (window.edenFrame._internal.injected) {
    log.info("Already injected, skipping");
    return;
  }
  window.edenFrame._internal.injected = true;

  let appId: string | null = null;
  let appName: string = "App";

  // Track current window bounds for floating windows
  // Using an object reference so we can update it and have the change reflected in all modules
  const currentBoundsRef: {
    current: { x: number; y: number; width: number; height: number } | null;
  } = { current: null };

  let cleanupDrag: (() => void) | null = null;
  let cleanupResize: (() => void) | null = null;

  // Create the overlay
  const overlay = createOverlay(window.edenFrame._internal.config);

  // Setup handlers after overlay is injected
  const setupHandlers = (): void => {
    // Get appId from injected config
    if (window.edenFrame && window.edenFrame._internal.appId) {
      appId = window.edenFrame._internal.appId;
      const rawName = window.edenFrame._internal.appName;

      // Async fetch locale
      window.edenAPI
        .shellCommand("i18n/get-locale", {})
        .then((response: { locale: string }) => {
          const locale = response?.locale;
          const currentLocale = locale || "en";
          appName = getAppName(rawName, currentLocale);
          setTitle(appName);

          // Update resetTitle to use this locale
          if (window.edenFrame) {
            window.edenFrame.setTitle = (title: string) => setTitle(title);
            (window.edenFrame as any).resetTitle = () => setTitle(appName);
          }
        })
        .catch(() => {
          appName = getAppName(rawName, "en");
          setTitle(appName);
          if (window.edenFrame) {
            window.edenFrame.setTitle = (title: string) => setTitle(title);
            (window.edenFrame as any).resetTitle = () => setTitle(appName);
          }
        });

      // Set initial title (english fallback) to avoid empty title while fetching
      setTitle(getAppName(rawName, "en"));

      // Subscribe to locale changes for live updates
      window.edenAPI.subscribe(
        "i18n/locale-changed",
        (data: { locale: string }) => {
          const newLocale = data.locale;
          const currentName = getAppName(rawName, newLocale);

          // Update title
          setTitle(currentName);

          // Update resetTitle to use the new locale
          if (window.edenFrame) {
            (window.edenFrame as any).resetTitle = () => setTitle(currentName);
          }
        },
      );
    }

    // Setup button handlers
    setupCloseButton();
    setupMinimizeButton();
    setupToggleModeButton();

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
      cleanupDrag = setupWindowDragging(overlay, currentBoundsRef);
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
  injectOverlay(overlay, () => {
    setupDarkMode(overlay);
    setupHandlers();
  });

  // Expose API for apps to update the title
  window.edenFrame.setTitle = (title: string) => {
    setTitle(title);
  };

  // Expose resetTitle immediately (using English/default name initially)
  // This will be updated to use the correct locale once fetched
  window.edenFrame.resetTitle = () => {
    // If locale hasn't loaded yet, getAppName will use 'en' fallback
    if (window.edenFrame) {
      const currentName = getAppName(
        window.edenFrame._internal.appName || window.edenFrame._internal.appId,
        "en",
      );
      setTitle(currentName);
    }
  };
})();

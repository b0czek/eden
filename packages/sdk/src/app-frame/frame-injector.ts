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
  console.log("[Eden Frame] Injection script started");

  // Initialize edenFrame object if not exists
  if (!window.edenFrame) {
    window.edenFrame = {
      setTitle: (title: string) => {
        /* will be set later */
      },
      _internal: {
        appId: "",
        injected: false,
        config: {},
        currentMode: "tiled",
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    };
  }

  // Check if already injected
  if (window.edenFrame._internal.injected) {
    console.log("[Eden Frame] Already injected, skipping");
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

  // Create the overlay
  const overlay = createOverlay(window.edenFrame._internal.config);

  // Setup handlers after overlay is injected
  const setupHandlers = (): void => {
    // Get appId from injected config
    if (window.edenFrame && window.edenFrame._internal.appId) {
      appId = window.edenFrame._internal.appId;
      appName = getAppName(appId);
      setTitle(appName);
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
        console.log(
          "[Eden Frame] View mode changed to:",
          mode,
          "with bounds:",
          bounds
        );

        // Update window mode and bounds
        window.edenFrame!._internal.currentMode = mode;
        if (bounds && bounds.x !== undefined) {
          window.edenFrame!._internal.bounds = bounds;
          currentBoundsRef.current = { ...bounds };
        }

        // Re-setup controls for new mode
        setupFloatingWindowControls();
      }
    );
    console.log("[Eden Frame] Subscribed to view/mode-changed");
  };

  const setupFloatingWindowControls = (): void => {
    const windowMode = window.edenFrame!._internal.currentMode;
    const windowConfig = window.edenFrame!._internal.config;
    const initialBounds = window.edenFrame!._internal.bounds;

    console.log(
      "[Eden Frame] Window mode:",
      windowMode,
      "Config:",
      windowConfig,
      "Initial bounds:",
      initialBounds
    );

    // Only enable dragging/resizing for floating windows
    if (windowMode !== "floating") {
      return;
    }

    // Initialize current bounds from the actual bounds set by ViewManager
    if (initialBounds && initialBounds.x !== undefined) {
      currentBoundsRef.current = { ...initialBounds };
      console.log(
        "[Eden Frame] Initialized bounds from backend:",
        currentBoundsRef.current
      );
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

      console.log(
        "[Eden Frame] Initialized bounds from config:",
        currentBoundsRef.current
      );
    }

    // Check if dragging is allowed
    const isMovable = windowConfig.movable !== false; // default true
    const isResizable = windowConfig.resizable !== false; // default true

    console.log("[Eden Frame] Movable:", isMovable, "Resizable:", isResizable);

    // Setup window dragging
    if (isMovable) {
      setupWindowDragging(overlay, currentBoundsRef);
    }

    // Setup window resizing
    if (isResizable) {
      setupWindowResizing(windowConfig, currentBoundsRef);
    }
  };

  // Listen for bounds updates from main process (during mouse drag/resize)
  // This keeps currentBounds in sync even when main process is controlling movement
  window.edenAPI.subscribe("view/bounds-updated", (newBounds) => {
    currentBoundsRef.current = { ...newBounds };
    window.edenFrame!._internal.bounds = { ...newBounds };
  });
  console.log("[Eden Frame] Subscribed to view/bounds-updated");

  // Add global touch handler to diagnose issues
  document.addEventListener(
    "touchstart",
    (e) => {
      console.log("[Eden Frame] Global touchstart on:", e.target);
    },
    { passive: false, capture: true }
  );

  document.addEventListener(
    "touchcancel",
    (e) => {
      console.log("[Eden Frame] Global touchcancel on:", e.target);
      console.log("[Eden Frame] Stack trace:", new Error().stack);
    },
    { capture: true }
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
})();

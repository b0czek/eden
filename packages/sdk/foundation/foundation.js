// Foundation Layer
// Handles workspace area reporting and global event handling

(() => {
  console.log("Foundation layer initializing...");

  const workspace = document.getElementById("workspace");
  if (!workspace) {
    console.error("Workspace element not found!");
    return;
  }

  /**
   * Report workspace bounds to the backend
   */
  function reportWorkspaceBounds() {
    const rect = workspace.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height) - 72,
    };

    // Get window size from body
    const windowSize = {
      width: Math.round(document.body.clientWidth),
      height: Math.round(document.body.clientHeight),
    };

    // Send to backend via eden API (provided by preload)
    window.edenAPI
      .shellCommand("view/update-global-bounds", { bounds, windowSize })
      .catch((error) => {
        console.error("Failed to update global bounds:", error);
      });
  }

  /**
   * Handle global mouseup events
   * Cleanup for any active drag/resize operations happening in app views
   */
  function handleGlobalMouseUp() {
    window.edenAPI.shellCommand("view/global-mouseup", {}).catch((error) => {
      console.error("Failed to send global-mouseup:", error);
    });
  }

  // Initial workspace bounds report
  reportWorkspaceBounds();

  // Watch for workspace resizes
  const resizeObserver = new ResizeObserver(() => {
    reportWorkspaceBounds();
  });
  resizeObserver.observe(workspace);

  // Listen for global mouseup events
  window.addEventListener("mouseup", handleGlobalMouseUp);

  // Listen for window resize events
  window.addEventListener("resize", () => {
    reportWorkspaceBounds();
  });

  // Wallpaper Transition Logic (Dynamic Stacking)
  const container = document.getElementById("wallpaper-container");
  let zIndexCounter = 1;

  // Initialize with default
  function createBaseLayer() {
    if (!container) return;
    const layer = document.createElement("div");
    layer.className = "wallpaper-layer";
    // Matches AppearanceManager default
    layer.style.background =
      "linear-gradient(135deg, #1e1e2e 0%, #1a1b26 100%)";
    layer.style.zIndex = zIndexCounter++;
    layer.style.opacity = "1";
    container.appendChild(layer);
  }

  // Clear container first to remove any static usage
  if (container) {
    container.innerHTML = "";
    createBaseLayer();

    // Fetch stored wallpaper preference
    window.edenAPI
      .shellCommand("appearance/get-wallpaper", {})
      .then((response) => {
        if (response?.wallpaper) {
          // Update base layer immediately
          const baseLayer = container.querySelector(".wallpaper-layer");
          if (baseLayer) {
            baseLayer.style.background = response.wallpaper.value;
          }
        }
      })
      .catch((err) => {
        console.error("Failed to fetch initial wallpaper:", err);
      });
  }

  window.edenAPI.subscribe("appearance/wallpaper-changed", (preset) => {
    if (!container) return;
    applyNewWallpaper(preset.value);
  });

  function applyNewWallpaper(cssValue) {
    // Create new layer on top
    const newLayer = document.createElement("div");
    newLayer.className = "wallpaper-layer";
    newLayer.style.background = cssValue;
    newLayer.style.zIndex = zIndexCounter++;
    newLayer.style.opacity = "0"; // Start hidden

    container.appendChild(newLayer);

    // Force Reflow
    void newLayer.offsetHeight;

    // Start Transition
    newLayer.style.opacity = "1";

    // Cleanup function for when this layer finishes transitioning
    const cleanup = () => {
      // We want to remove all layers that are LOWER than this newLayer.
      // Because newLayer is now fully opaque (conceptually), anything below it is invisible.
      const layers = Array.from(
        container.getElementsByClassName("wallpaper-layer"),
      );
      const currentZ = parseInt(newLayer.style.zIndex, 10);

      layers.forEach((layer) => {
        // Don't remove self
        if (layer === newLayer) return;

        const layerZ = parseInt(layer.style.zIndex, 10);
        if (layerZ < currentZ) {
          layer.remove();
        }
      });

      newLayer.removeEventListener("transitionend", cleanup);
    };

    newLayer.addEventListener("transitionend", cleanup);

    // Safety timeout to ensure cleanup happens even if event is missed
    setTimeout(() => {
      if (newLayer.parentNode) cleanup();
    }, 700);
  }

  console.log("Foundation layer initialized");
})();

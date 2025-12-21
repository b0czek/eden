import { createSignal, onMount, onCleanup, Show } from "solid-js";
import Dock from "./Dock";
import AllApps from "./AllApps";
import {
  ViewBounds,
  WindowSize,
  AppManifest,
  AppInstance,
} from "@edenapp/types";
import { AppInfo } from "../types";

// Constants
const DOCK_HEIGHT = 72; // Should match --eden-layout-dock-height in pixels

export default function ShellOverlay() {
  const [runningApps, setRunningApps] = createSignal<AppInstance[]>([]);
  const [installedApps, setInstalledApps] = createSignal<AppManifest[]>([]);
  const [showAllApps, setShowAllApps] = createSignal(false);

  // Running apps for the dock (use manifest embedded in AppInstance)
  const dockApps = (): AppInfo[] => {
    return runningApps().map((instance) => ({
      id: instance.manifest.id,
      name: instance.manifest.name,
      isRunning: true,
    }));
  };

  // All installed apps for the apps view
  const allApps = (): AppInfo[] => {
    const runningIds = new Set(runningApps().map((i) => i.manifest.id));
    return installedApps().map((app) => ({
      id: app.id,
      name: app.name,
      isRunning: runningIds.has(app.id),
    }));
  };

  const loadSystemInfo = async () => {
    try {
      // Fetch installed apps from package manager
      const installed = await window.edenAPI!.shellCommand("package/list", {});
      if (Array.isArray(installed)) {
        setInstalledApps(installed);
      }

      // Fetch running apps from process manager
      const running = await window.edenAPI!.shellCommand("process/list", {});
      if (Array.isArray(running)) {
        setRunningApps(running);
      }
    } catch (error) {
      console.error("Failed to load system info:", error);
    }
  };

  // Helper function to calculate bounds based on mode and window size
  const calculateBounds = (
    mode: "dock" | "fullscreen",
    windowSize: WindowSize
  ) => {
    return mode === "fullscreen"
      ? { x: 0, y: 0, width: windowSize.width, height: windowSize.height }
      : {
          x: 0,
          y: windowSize.height - DOCK_HEIGHT,
          width: windowSize.width,
          height: DOCK_HEIGHT,
        };
  };

  // Helper function to update overlay bounds via API
  const updateOverlayBounds = async (bounds: ViewBounds) => {
    try {
      await window.edenAPI!.shellCommand("view/update-view-bounds", {
        appId: "com.eden.eveshell",
        bounds,
      });
    } catch (error) {
      console.error("Failed to update overlay bounds:", error);
    }
  };

  const requestResize = async (mode: "dock" | "fullscreen") => {
    try {
      // Get current window bounds
      const windowSize = await window.edenAPI!.shellCommand(
        "view/window-size",
        {}
      );
      const bounds = calculateBounds(mode, windowSize);
      await updateOverlayBounds(bounds);
    } catch (error) {
      console.error("Failed to resize overlay:", error);
    }
  };

  const handleAppClick = async (appId: string) => {
    const isRunning = runningApps().some((app) => app.manifest.id === appId);

    if (isRunning) {
      // App is running, focus/show it
      try {
        await window.edenAPI!.shellCommand("view/focus-app", { appId });
      } catch (error) {
        console.error("Failed to focus app:", error);
      }
    } else {
      // App is not running, launch it
      try {
        await window.edenAPI!.shellCommand("process/launch", { appId });
        // Add a small delay before refreshing to let the app start
        setTimeout(() => {
          loadSystemInfo();
        }, 500);
      } catch (error) {
        console.error("Failed to launch app:", error);
      }
    }
  };

  const handleShowAllApps = async () => {
    const next = !showAllApps();
    setShowAllApps(next);

    // Resize overlay
    await requestResize(next ? "fullscreen" : "dock");

    // Refresh installed apps when opening the apps view
    if (next) {
      loadSystemInfo();
    }
  };

  const handleStopApp = async (appId: string) => {
    try {
      await window.edenAPI!.shellCommand("process/stop", { appId });
      // Refresh app list
      setTimeout(() => {
        loadSystemInfo();
      }, 300);
    } catch (error) {
      console.error("Failed to stop app:", error);
    }
  };

  const handleUninstallApp = async (appId: string) => {
    try {
      // Confirm before uninstalling
      if (confirm(`Are you sure you want to uninstall this app?`)) {
        await window.edenAPI!.shellCommand("package/uninstall", { appId });
        // Refresh app list
        await loadSystemInfo();
      }
    } catch (error) {
      console.error("Failed to uninstall app:", error);
    }
  };

  onMount(() => {
    // Event handlers
    const handleAppLifecycle = () => loadSystemInfo();

    const handleBoundsChange = (data: {
      workspaceBounds: ViewBounds;
      windowSize: WindowSize;
    }) => {
      const { windowSize } = data;
      const mode = showAllApps() ? "fullscreen" : "dock";
      const bounds = calculateBounds(mode, windowSize);
      updateOverlayBounds(bounds);
    };

    // Register cleanup synchronously (must happen before any async work)
    onCleanup(() => {
      window.edenAPI!.unsubscribe("process/launched", handleAppLifecycle);
      window.edenAPI!.unsubscribe("process/stopped", handleAppLifecycle);
      window.edenAPI!.unsubscribe(
        "view/global-bounds-changed",
        handleBoundsChange
      );
    });

    // Async initialization
    (async () => {
      // Load initial system info
      loadSystemInfo();

      // Set initial overlay size
      await requestResize("dock");

      try {
        // Subscribe to events
        await window.edenAPI!.subscribe("process/launched", handleAppLifecycle);
        await window.edenAPI!.subscribe("process/stopped", handleAppLifecycle);
        await window.edenAPI!.subscribe(
          "view/global-bounds-changed",
          handleBoundsChange
        );
      } catch (error) {
        console.error("Failed to subscribe to events:", error);
      }
    })();
  });

  return (
    <div
      class="shell-overlay"
      data-mode={showAllApps() ? "fullscreen" : "dock"}
    >
      {/* AllApps appears above the dock when active */}
      <Show when={showAllApps()}>
        <AllApps
          apps={allApps()}
          onClose={handleShowAllApps}
          onAppClick={handleAppClick}
          onStopApp={handleStopApp}
          onUninstallApp={handleUninstallApp}
        />
      </Show>

      {/* Dock is always visible */}
      <Dock
        apps={dockApps()}
        onAppClick={handleAppClick}
        onShowAllApps={handleShowAllApps}
      />
    </div>
  );
}

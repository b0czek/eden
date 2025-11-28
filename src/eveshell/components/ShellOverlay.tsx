import { createSignal, onMount, onCleanup, Show } from "solid-js";
import Dock from "./Dock";
import AllApps from "./AllApps";
import { ViewBounds, WindowSize } from "../../types";

interface AppManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  icon?: string;
}

interface AppInfo {
  id: string;
  name: string;
  icon?: string;
  isRunning: boolean;
}

// Constants
const DOCK_HEIGHT = 72; // Should match --eden-layout-dock-height in pixels

export default function ShellOverlay() {
  const [runningApps, setRunningApps] = createSignal<Set<string>>(new Set());
  const [installedApps, setInstalledApps] = createSignal<AppManifest[]>([]);
  const [showAllApps, setShowAllApps] = createSignal(false);

  // Combine installed and running apps for the dock
  const dockApps = () => {
    const running = runningApps();
    const installed = installedApps();

    // Show running apps in the dock
    const apps: AppInfo[] = Array.from(running).map((appId) => {
      const manifest = installed.find((app) => app.id === appId);
      return {
        id: appId,
        name: manifest?.name || appId,
        icon: manifest?.icon,
        isRunning: true,
      };
    });

    return apps;
  };

  // All apps for the apps view
  const allApps = () => {
    const running = runningApps();
    const apps = installedApps().map((app) => ({
      id: app.id,
      name: app.name,
      icon: app.icon,
      isRunning: running.has(app.id),
    }));
    return apps;
  };

  const loadSystemInfo = async () => {
    try {
      const info = await window.edenAPI.shellCommand("system/info", {});
      setRunningApps(new Set<string>(info.runningApps || []));

      const appsData = await window.edenAPI.shellCommand("process/list", {});

      if (appsData) {
        if (Array.isArray(appsData.installed)) {
          setInstalledApps(appsData.installed);
        }
      }
    } catch (error) {
      console.error("Failed to load system info:", error);
    }
  };

  // Helper function to calculate bounds based on mode and window size
  const calculateBounds = (mode: "dock" | "fullscreen", windowSize: WindowSize) => {
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
      await window.edenAPI.shellCommand("view/update-view-bounds", {
        appId: "eden.shell-overlay",
        bounds,
      });
    } catch (error) {
      console.error("Failed to update overlay bounds:", error);
    }
  };

  const requestResize = async (mode: "dock" | "fullscreen") => {
    try {
      // Get current window bounds
      const windowSize = await window.edenAPI.shellCommand(
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
    const running = runningApps();

    if (running.has(appId)) {
      // App is running, focus/show it
      try {
        await window.edenAPI.shellCommand("view/focus-app", { appId });
      } catch (error) {
        console.error("Failed to focus app:", error);
      }
    } else {
      // App is not running, launch it
      try {
        await window.edenAPI.shellCommand("process/launch", { appId });
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

  const handleInstallApp = async () => {
    try {
      const filePath = await window.edenAPI.selectFile({
        title: "Select Eden App Package",
        filters: [{ name: "Eden Package", extensions: ["edenite"] }],
      });

      if (filePath) {
        await window.edenAPI.shellCommand("package/install", {
          sourcePath: filePath,
        });
        // Refresh app list
        await loadSystemInfo();
      }
    } catch (error) {
      console.error("Failed to install app:", error);
    }
  };

  const handleStopApp = async (appId: string) => {
    try {
      await window.edenAPI.shellCommand("process/stop", { appId });
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
        await window.edenAPI.shellCommand("package/uninstall", { appId });
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

    const handleBoundsChange = (data: { workspaceBounds: ViewBounds; windowSize: WindowSize }) => {
      const { windowSize } = data;
      const mode = showAllApps() ? "fullscreen" : "dock";
      const bounds = calculateBounds(mode, windowSize);
      updateOverlayBounds(bounds);
    };

    // Register cleanup synchronously (must happen before any async work)
    onCleanup(() => {
      window.edenAPI.unsubscribe("process/launched", handleAppLifecycle);
      window.edenAPI.unsubscribe("process/stopped", handleAppLifecycle);
      window.edenAPI.unsubscribe(
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
        await window.edenAPI.subscribe("process/launched", handleAppLifecycle);
        await window.edenAPI.subscribe("process/stopped", handleAppLifecycle);
        await window.edenAPI.subscribe(
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
      <Show when={!showAllApps()}>
        <Dock
          apps={dockApps()}
          onAppClick={handleAppClick}
          onShowAllApps={handleShowAllApps}
        />
      </Show>

      <Show when={showAllApps()}>
        <AllApps
          apps={allApps()}
          runningApps={runningApps()}
          onClose={handleShowAllApps}
          onInstall={handleInstallApp}
          onAppClick={handleAppClick}
          onStopApp={handleStopApp}
          onUninstallApp={handleUninstallApp}
        />
      </Show>
    </div>
  );
}

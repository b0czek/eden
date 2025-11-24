import { createSignal, onMount, Show } from "solid-js";
import Dock from "./Dock";
import AllApps from "./AllApps";

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
const DOCK_HEIGHT = 80; // Should match --eden-layout-dock-height in pixels

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
      const info = await window.edenAPI.getSystemInfo();
      console.log("System info:", info);

      setRunningApps(new Set<string>(info.runningApps || []));

      // Get list of installed apps
      const appsData = await window.edenAPI.shellCommand("process/list", {});

      // AppManager returns { installed: AppManifest[], running: [...] }
      if (appsData) {
        if (Array.isArray(appsData.installed)) {
          setInstalledApps(appsData.installed);
        } else if (Array.isArray(appsData.apps)) {
          setInstalledApps(appsData.apps);
        } else if (Array.isArray(appsData)) {
          setInstalledApps(appsData as any);
        }
      }
    } catch (error) {
      console.error("Failed to load system info:", error);
    }
  };

  const requestResize = async (mode: "dock" | "fullscreen") => {
    try {
      // Get current window bounds
      const windowSize = await window.edenAPI.shellCommand("app/get-window-size", {});
      console.log(windowSize);
      const bounds =
        mode === "fullscreen"
          ? { x: 0, y: 0, width: windowSize.width, height: windowSize.height }
          : {
              x: 0,
              y: windowSize.height - DOCK_HEIGHT,
              width: windowSize.width,
              height: DOCK_HEIGHT,
            };

      // Use standard update-view-bounds API with appId
      await window.edenAPI.shellCommand("app/update-view-bounds", {
        appId: "eden.shell-overlay",
        bounds,
      });
    } catch (error) {
      console.error("Failed to resize overlay:", error);
    }
  };

  const handleAppClick = async (appId: string) => {
    const running = runningApps();

    if (running.has(appId)) {
      // App is running, focus/show it
      try {
        await window.edenAPI.shellCommand("app/focus-app", { appId });
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
        await window.edenAPI.shellCommand("app/install", {
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
        await window.edenAPI.shellCommand("app/uninstall", { appId });
        // Refresh app list
        await loadSystemInfo();
      }
    } catch (error) {
      console.error("Failed to uninstall app:", error);
    }
  };

  onMount(() => {
    // Load initial system info
    loadSystemInfo();

    // Listen for overlay initialization message with viewId
    window.edenAPI.onSystemMessage((message) => {

      if (message.type === "app/launched" || message.type === "app/stopped") {
        loadSystemInfo();
      }
      
      // Listen for workspace bounds changes and recalculate position
      if (message.type === "app/workspace-bounds-changed") {
        const { bounds } = message.payload;
        const mode = showAllApps() ? "fullscreen" : "dock";
        // Recalculate our desired bounds based on new workspace size
        const newBounds =
          mode === "fullscreen"
            ? { x: 0, y: 0, width: bounds.width, height: bounds.height }
            : {
                x: 0,
                y: bounds.height,
                width: bounds.width,
                height: DOCK_HEIGHT,
              };

        // Send update to reposition ourselves
        window.edenAPI.shellCommand("app/update-view-bounds", {
          appId: "eden.shell-overlay",
          bounds: newBounds,
        }).catch((error) => {
          console.error("Failed to update overlay bounds:", error);
        });
      }
    });
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

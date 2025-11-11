import { createSignal, onMount, createEffect, For, Show } from "solid-js";
import Dock from "./Dock";
import AppIcon from "./AppIcon";

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

export default function Shell() {
  const [runningApps, setRunningApps] = createSignal<Set<string>>(new Set());
  const [installedApps, setInstalledApps] = createSignal<AppManifest[]>([]);
  const [showAllApps, setShowAllApps] = createSignal(false);
  const [contextMenu, setContextMenu] = createSignal<{
    appId: string;
    appName: string;
    isRunning: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [longPressTimer, setLongPressTimer] = createSignal<number | null>(null);

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
    console.log("All apps:", apps);
    return apps;
  };

  const loadSystemInfo = async () => {
    try {
      const info = await window.edenAPI.getSystemInfo();
      console.log("System info:", info);

      setRunningApps(new Set<string>(info.runningApps || []));

      // Get list of installed apps
      const appsData = await window.edenAPI.shellCommand("list-apps", {});
      console.log("Installed apps response:", appsData);

      // AppManager returns { installed: AppManifest[], running: [...] }
      if (appsData) {
        if (Array.isArray(appsData.installed)) {
          console.log(
            "Setting installed apps from 'installed' key:",
            appsData.installed
          );
          setInstalledApps(appsData.installed);
        } else if (Array.isArray(appsData.apps)) {
          // Backwards compatibility
          console.log("Setting installed apps from 'apps' key:", appsData.apps);
          setInstalledApps(appsData.apps);
        } else if (Array.isArray(appsData)) {
          // If the command returned an array directly
          console.log("Setting installed apps from array response:", appsData);
          setInstalledApps(appsData as any);
        } else if (
          appsData.installed &&
          Array.isArray(appsData.installed.apps)
        ) {
          // Nested shape: { installed: { apps: [...] } }
          console.log(
            "Setting installed apps from nested 'installed.apps':",
            appsData.installed.apps
          );
          setInstalledApps(appsData.installed.apps);
        } else {
          console.warn("Unexpected apps data format:", appsData);
        }
      }
    } catch (error) {
      console.error("Failed to load system info:", error);
    }
  };

  const handleAppClick = async (appId: string) => {
    const running = runningApps();

    if (running.has(appId)) {
      // App is running, focus/show it
      try {
        await window.edenAPI.shellCommand("focus-app", { appId });
      } catch (error) {
        console.error("Failed to focus app:", error);
      }
    } else {
      // App is not running, launch it
      try {
        // Calculate bounds for the app view (full workspace area)
        const workspace = document.getElementById("workspace");
        if (!workspace) return;

        const rect = workspace.getBoundingClientRect();
        const bounds = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };

        console.log("Launching app with bounds:", bounds);

        await window.edenAPI.shellCommand("launch-app", { appId, bounds });
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

    // Show/hide running apps when toggling the apps view
    const running = runningApps();
    for (const appId of running) {
      try {
        await window.edenAPI.shellCommand("set-view-visibility", {
          appId,
          visible: !next, // visible when apps view is hidden
        });
      } catch (error) {
        console.error(`Failed to set visibility for ${appId}:`, error);
      }
    }

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
        await window.edenAPI.shellCommand("install-app", {
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
      await window.edenAPI.shellCommand("stop-app", { appId });
      setContextMenu(null);
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
        await window.edenAPI.shellCommand("uninstall-app", { appId });
        setContextMenu(null);
        // Refresh app list
        await loadSystemInfo();
      }
    } catch (error) {
      console.error("Failed to uninstall app:", error);
    }
  };

  const handleContextMenu = (
    e: MouseEvent,
    appId: string,
    appName: string,
    isRunning: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      appId,
      appName,
      isRunning,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleLongPressStart = (
    e: TouchEvent | MouseEvent,
    appId: string,
    appName: string,
    isRunning: boolean
  ) => {
    const timer = window.setTimeout(() => {
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      setContextMenu({
        appId,
        appName,
        isRunning,
        x: clientX,
        y: clientY,
      });
    }, 500); // 500ms long press
    setLongPressTimer(timer);
  };

  const handleLongPressEnd = () => {
    const timer = longPressTimer();
    if (timer) {
      clearTimeout(timer);
      setLongPressTimer(null);
    }
  };

  const updateRunningAppBounds = async () => {
    const workspace = document.getElementById("workspace");

    if (!workspace) return;

    const rect = workspace.getBoundingClientRect();
    const bounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };

    // Send workspace bounds update to backend
    // ViewManager will handle tiling recalculation if enabled
    try {
      await window.edenAPI.shellCommand("update-workspace-bounds", { bounds });
    } catch (error) {
      console.error("Failed to update workspace bounds:", error);
    }
  };

  onMount(() => {
    // Load initial system info
    loadSystemInfo();

    // Send initial workspace bounds
    const workspace = document.getElementById("workspace");
    if (workspace) {
      const rect = workspace.getBoundingClientRect();
      const bounds = {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      window.edenAPI.shellCommand("update-workspace-bounds", { bounds }).catch(console.error);
    }

    // Listen for system messages
    window.edenAPI.onSystemMessage((message) => {
      console.log("System message:", message);

      if (message.type === "app-started" || message.type === "app-stopped") {
        loadSystemInfo();
      }
    });

    // Watch for workspace resize
    if (workspace) {
      const resizeObserver = new ResizeObserver(() => {
        updateRunningAppBounds();
      });
      resizeObserver.observe(workspace);
    }

    // Also handle window resize as a fallback
    window.addEventListener("resize", () => {
      updateRunningAppBounds();
    });
  });

  return (
    <div class="shell">
      <div class="workspace" id="workspace">
        {/* Apps render as WebContentsViews managed by ViewManager */}
      </div>

      <Dock
        apps={dockApps()}
        onAppClick={handleAppClick}
        onShowAllApps={handleShowAllApps}
      />

      <Show when={showAllApps()}>
        <div class="apps-view-overlay" onClick={handleShowAllApps}>
          <div class="apps-view" onClick={(e) => e.stopPropagation()}>
            <div class="apps-view-header">
              <h2>All Applications</h2>
              <button onClick={handleInstallApp} class="install-btn">
                Install App
              </button>
              <button onClick={handleShowAllApps} class="close-btn">
                ✕
              </button>
            </div>
            <div class="apps-grid">
              <For each={allApps()}>
                {(app) => (
                  <div
                    class="app-grid-item"
                    classList={{ running: app.isRunning }}
                    onClick={async (e) => {
                      // Only handle click if not opening context menu
                      if (!contextMenu()) {
                        // Close apps view first
                        setShowAllApps(false);
                        
                        // Show all running apps
                        const running = runningApps();
                        for (const appId of running) {
                          try {
                            await window.edenAPI.shellCommand("set-view-visibility", {
                              appId,
                              visible: true,
                            });
                          } catch (error) {
                            console.error(`Failed to set visibility for ${appId}:`, error);
                          }
                        }
                        
                        // Then handle the app click
                        await handleAppClick(app.id);
                      }
                    }}
                    onContextMenu={(e) =>
                      handleContextMenu(e, app.id, app.name, app.isRunning)
                    }
                    onMouseDown={(e) => {
                      if (e.button === 0) {
                        // Left click only
                        handleLongPressStart(
                          e,
                          app.id,
                          app.name,
                          app.isRunning
                        );
                      }
                    }}
                    onMouseUp={handleLongPressEnd}
                    onMouseLeave={handleLongPressEnd}
                    onTouchStart={(e) =>
                      handleLongPressStart(e, app.id, app.name, app.isRunning)
                    }
                    onTouchEnd={handleLongPressEnd}
                    onTouchCancel={handleLongPressEnd}
                  >
                    <AppIcon
                      appId={app.id}
                      appName={app.name}
                      icon={app.icon}
                      isRunning={app.isRunning}
                    />
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>

      {/* Context Menu */}
      <Show when={contextMenu()}>
        {(menu) => (
          <>
            <div
              class="context-menu-overlay"
              onClick={() => setContextMenu(null)}
            />
            <div
              class="context-menu"
              style={{
                left: `${menu().x}px`,
                top: `${menu().y}px`,
              }}
            >
              <div class="context-menu-header">{menu().appName}</div>
              <Show when={menu().isRunning}>
                <button
                  class="context-menu-item"
                  onClick={() => handleStopApp(menu().appId)}
                >
                  <span class="context-menu-icon">⏹</span>
                  Stop App
                </button>
              </Show>
              <button
                class="context-menu-item danger"
                onClick={() => handleUninstallApp(menu().appId)}
              >
                <span class="context-menu-icon">🗑</span>
                Uninstall
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  );
}

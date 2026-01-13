import { createSignal, onMount, onCleanup, Show } from "solid-js";
import Dock from "./Dock";
import AllApps from "./AllApps";
import AppContextMenu, { ContextMenuData } from "./AppContextMenu";
import {
  ViewBounds,
  WindowSize,
  AppManifest,
  AppInstance,
} from "@edenapp/types";
import { AppInfo } from "../types";
import { t, initLocale, locale, getLocalizedAppName } from "../i18n";

// Constants
const DOCK_HEIGHT = 72; // Should match --eden-layout-dock-height in pixels

// Database key for persisting pinned dock apps
const PINNED_DOCK_APPS_KEY = "pinned-dock-apps";

export default function ShellOverlay() {
  const [runningApps, setRunningApps] = createSignal<AppInstance[]>([]);
  const [installedApps, setInstalledApps] = createSignal<AppManifest[]>([]);
  const [pinnedDockApps, setPinnedDockApps] = createSignal<string[]>([]);
  const [showAllApps, setShowAllApps] = createSignal(false);
  const [dockContextMenu, setDockContextMenu] = createSignal<ContextMenuData | null>(null);

  // Load pinned apps from database
  const loadPinnedApps = async () => {
    try {
      const result = await window.edenAPI.shellCommand("db/get", {
        key: PINNED_DOCK_APPS_KEY,
      });
      if (result.value) {
        const parsed = JSON.parse(result.value);
        if (Array.isArray(parsed)) {
          setPinnedDockApps(parsed);
        }
      }
    } catch (error) {
      console.error("Failed to load pinned dock apps:", error);
    }
  };

  // Save pinned apps to database
  const savePinnedApps = async (appIds: string[]) => {
    try {
      await window.edenAPI.shellCommand("db/set", {
        key: PINNED_DOCK_APPS_KEY,
        value: JSON.stringify(appIds),
      });
    } catch (error) {
      console.error("Failed to save pinned dock apps:", error);
    }
  };

  // Add an app to the dock (pin it)
  const handleAddToDock = async (appId: string) => {
    const current = pinnedDockApps();
    if (!current.includes(appId)) {
      const updated = [...current, appId];
      setPinnedDockApps(updated);
      await savePinnedApps(updated);
    }
  };

  // Remove an app from the dock (unpin it)
  const handleRemoveFromDock = async (appId: string) => {
    const current = pinnedDockApps();
    const updated = current.filter((id) => id !== appId);
    setPinnedDockApps(updated);
    await savePinnedApps(updated);
  };

  // Check if an app is pinned to the dock
  const isAppPinned = (appId: string): boolean => {
    return pinnedDockApps().includes(appId);
  };

  // Running apps that are NOT pinned (for the left section of dock)
  const dockRunningApps = (): AppInfo[] => {
    return runningApps()
      .filter((instance) => !pinnedDockApps().includes(instance.manifest.id))
      .map((instance) => ({
        id: instance.manifest.id,
        name: getLocalizedAppName(instance.manifest, locale()),
        isRunning: true,
      }));
  };

  // Pinned apps with their running status (for the right section of dock)
  const dockPinnedApps = (): AppInfo[] => {
    const runningIds = new Set(runningApps().map((i) => i.manifest.id));
    const installed = installedApps();

    return pinnedDockApps()
      .map((appId) => {
        const manifest = installed.find((m) => m.id === appId);
        if (!manifest) return null;
        return {
          id: appId,
          name: getLocalizedAppName(manifest, locale()),
          isRunning: runningIds.has(appId),
        };
      })
      .filter((app): app is AppInfo => app !== null);
  };

  // All installed apps for the apps view
  const allApps = (): AppInfo[] => {
    const runningIds = new Set(runningApps().map((i) => i.manifest.id));
    return installedApps().map((app) => ({
      id: app.id,
      name: getLocalizedAppName(app, locale()),
      isRunning: runningIds.has(app.id),
    }));
  };

  const loadSystemInfo = async () => {
    try {
      // Fetch installed apps from package manager
      const installed = await window.edenAPI.shellCommand("package/list", {});
      if (Array.isArray(installed)) {
        setInstalledApps(installed);
      }

      // Fetch running apps from process manager
      const running = await window.edenAPI.shellCommand("process/list", {});
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
      await window.edenAPI.shellCommand("view/update-view-bounds", {
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
    const isRunning = runningApps().some((app) => app.manifest.id === appId);

    if (isRunning) {
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
      if (confirm(t("shell.uninstallConfirm"))) {
        await window.edenAPI.shellCommand("package/uninstall", { appId });
        // Refresh app list
        await loadSystemInfo();
      }
    } catch (error) {
      console.error("Failed to uninstall app:", error);
    }
  };

  // Handle context menu from dock - resize to fullscreen so menu fits
  const handleDockContextMenu = async (menu: ContextMenuData) => {
    await requestResize("fullscreen");
    setDockContextMenu(menu);
  };

  // Close dock context menu and resize back to dock
  const handleCloseDockContextMenu = async () => {
    setDockContextMenu(null);
    if (!showAllApps()) {
      await requestResize("dock");
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
      window.edenAPI.unsubscribe("process/launched", handleAppLifecycle);
      window.edenAPI.unsubscribe("process/stopped", handleAppLifecycle);
      window.edenAPI.unsubscribe(
        "view/global-bounds-changed",
        handleBoundsChange
      );
    });

    // Async initialization
    (async () => {
      // Initialize i18n (will load locale and subscribe to changes)
      await initLocale();
      
      // Load initial system info and pinned apps
      loadSystemInfo();
      loadPinnedApps();

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
      data-mode={showAllApps() || dockContextMenu() ? "fullscreen" : "dock"}
    >
      {/* AllApps appears above the dock when active */}
      <Show when={showAllApps()}>
        <AllApps
          apps={allApps()}
          onClose={handleShowAllApps}
          onAppClick={handleAppClick}
          onStopApp={handleStopApp}
          onUninstallApp={handleUninstallApp}
          isAppPinned={isAppPinned}
          onAddToDock={handleAddToDock}
          onRemoveFromDock={handleRemoveFromDock}
        />
      </Show>

      {/* Dock is always visible */}
      <Dock
        runningApps={dockRunningApps()}
        pinnedApps={dockPinnedApps()}
        onAppClick={handleAppClick}
        onShowAllApps={handleShowAllApps}
        onContextMenu={handleDockContextMenu}
      />

      {/* Context menu for dock apps */}
      <Show when={dockContextMenu()}>
        {(menu) => (
          <AppContextMenu
            menu={menu()}
            isAppPinned={isAppPinned}
            onStopApp={handleStopApp}
            onAddToDock={handleAddToDock}
            onRemoveFromDock={handleRemoveFromDock}
            onUninstallApp={handleUninstallApp}
            onClose={handleCloseDockContextMenu}
          />
        )}
      </Show>
    </div>
  );
}

import { createOverlayLayout, KeyboardButton } from "@edenapp/solid-kit";
import { createDialogs, DialogHost } from "@edenapp/solid-kit/dialogs";
import type {
  AppInstance,
  AppManifest,
  EdenPowerCapabilities,
  UserProfile,
  WindowSize,
} from "@edenapp/types";
import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { createAppMenu, createUserContextMenu } from "../context-menu";
import { useAppOperations } from "../features/useAppOperations";
import { useSessionTransition } from "../features/useSessionTransition";
import { getLocalizedValue, initLocale, locale, t } from "../i18n";
import type { AppInfo } from "../types";
import AllApps from "./AllApps";
import { openChangePasswordDialog } from "./ChangePasswordDialog";
import Dock from "./Dock";
import SessionTransitionOverlay from "./SessionTransitionOverlay";

// Constants
const DOCK_HEIGHT = 72; // Should match --eden-layout-dock-height in CSS pixels

// Database key for persisting pinned dock apps
const PINNED_DOCK_APPS_KEY = "pinned-dock-apps";

export default function ShellOverlay() {
  const dialogs = createDialogs();
  const [runningApps, setRunningApps] = createSignal<AppInstance[]>([]);
  const [installedApps, setInstalledApps] = createSignal<AppManifest[]>([]);
  const [pinnedDockApps, setPinnedDockApps] = createSignal<string[]>([]);
  const [showAllApps, setShowAllApps] = createSignal(false);
  const [showChangePassword, setShowChangePassword] = createSignal(false);
  const [powerCapabilities, setPowerCapabilities] =
    createSignal<EdenPowerCapabilities>({ poweroff: false, reboot: false });
  const [currentUser, setCurrentUser] = createSignal<UserProfile | null>(null);
  const appOperations = useAppOperations({
    dialogs,
    refresh: () => loadSystemInfo(),
  });
  const sessionTransition = useSessionTransition({ dialogs });
  const isFullscreen = () =>
    showAllApps() ||
    showChangePassword() ||
    sessionTransition.confirming() ||
    appOperations.hasErrorDialog() ||
    sessionTransition.visible();
  let overlayElement: HTMLDivElement | undefined;

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
    const instances = runningApps();
    const running = instances
      .filter((instance) => !pinnedDockApps().includes(instance.manifest.id))
      .map((instance) => ({
        id: instance.manifest.id,
        name: getLocalizedValue(instance.manifest.name, locale()),
        isRunning: true,
        activity: appOperations.activity(instance.manifest.id),
      }));
    const launching = installedApps().filter(
      (app) =>
        appOperations.activity(app.id) === "launch" &&
        !pinnedDockApps().includes(app.id) &&
        !instances.some((instance) => instance.manifest.id === app.id),
    );
    return [
      ...running,
      ...launching.map((app) => ({
        id: app.id,
        name: getLocalizedValue(app.name, locale()),
        isRunning: false,
        activity: "launch" as const,
      })),
    ];
  };

  // Pinned apps with their running status (for the right section of dock)
  const dockPinnedApps = (): AppInfo[] => {
    const runningIds = new Set(runningApps().map((i) => i.manifest.id));
    const installed = installedApps();

    return pinnedDockApps()
      .map((appId): AppInfo | null => {
        const manifest = installed.find((m) => m.id === appId);
        if (!manifest) return null;
        return {
          id: appId,
          name: getLocalizedValue(manifest.name, locale()),
          isRunning: runningIds.has(appId),
          activity: appOperations.activity(appId),
        };
      })
      .filter((app): app is AppInfo => app !== null);
  };

  // All installed apps for the apps view (already filtered by permissions from package/list)
  const allApps = (): AppInfo[] => {
    const runningIds = new Set(runningApps().map((i) => i.manifest.id));
    return installedApps().map((app) => ({
      id: app.id,
      name: getLocalizedValue(app.name, locale()),
      isRunning: runningIds.has(app.id),
      activity: appOperations.activity(app.id),
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

  const loadCurrentUser = async () => {
    try {
      const result = await window.edenAPI.shellCommand(
        "session/get-current",
        {},
      );
      setCurrentUser(result.user ?? null);
    } catch (error) {
      console.error("Failed to load current user:", error);
    }
  };

  const loadPowerCapabilities = async () => {
    try {
      setPowerCapabilities(
        await window.edenAPI.shellCommand("system/power-capabilities", {}),
      );
    } catch (error) {
      console.error("Failed to load power capabilities:", error);
    }
  };

  // Helper function to calculate bounds based on mode and window size
  const calculateBounds = (
    mode: "dock" | "fullscreen",
    windowSize: WindowSize,
    scale: number,
  ) => {
    const scaledDockHeight = Math.round(DOCK_HEIGHT * scale);

    return mode === "fullscreen"
      ? { x: 0, y: 0, width: windowSize.width, height: windowSize.height }
      : {
          x: 0,
          y: windowSize.height - scaledDockHeight,
          width: windowSize.width,
          height: scaledDockHeight,
        };
  };

  createOverlayLayout({
    element: () => overlayElement,
    dependencies: [() => isFullscreen()],
    deriveBounds: ({ windowSize, scale }) =>
      calculateBounds(
        isFullscreen() ? "fullscreen" : "dock",
        windowSize,
        scale,
      ),
  });

  const handleAppClick = async (appId: string) => {
    if (appOperations.activity(appId)) return;
    const isRunning = runningApps().some((app) => app.manifest.id === appId);

    if (isRunning) {
      // App is running, focus/show it
      try {
        await window.edenAPI.shellCommand("view/focus-view", { appId });
      } catch (error) {
        console.error("Failed to focus app:", error);
      }
    } else {
      await appOperations.launch(appId);
    }
  };

  const handleShowAllApps = () => {
    const next = !showAllApps();
    setShowAllApps(next);

    // Refresh installed apps when opening the apps view
    if (next) {
      loadSystemInfo();
    }
  };

  // Create menu once with actions - just pass app data when opening
  const appMenu = createAppMenu({
    open: handleAppClick,
    stop: appOperations.stop,
    addToDock: handleAddToDock,
    removeFromDock: handleRemoveFromDock,
    isPinned: isAppPinned,
  });

  const handleOpenChangePassword = async () => {
    setShowChangePassword(true);

    try {
      await openChangePasswordDialog({
        dialogs,
      });
    } finally {
      setShowChangePassword(false);
    }
  };

  // Create user menu factory
  const userContextMenu = createUserContextMenu({
    changePassword: handleOpenChangePassword,
    logout: () => sessionTransition.request("logout"),
    reboot: () => sessionTransition.request("reboot"),
    poweroff: () => sessionTransition.request("poweroff"),
    canReboot: () => powerCapabilities().reboot,
    canPoweroff: () => powerCapabilities().poweroff,
  });

  onMount(() => {
    // Event handlers
    const handleAppLifecycle = () => loadSystemInfo();

    // Register cleanup synchronously (must happen before any async work)
    onCleanup(() => {
      window.edenAPI.unsubscribe("process/launched", handleAppLifecycle);
      window.edenAPI.unsubscribe("process/stopped", handleAppLifecycle);
    });

    // Async initialization
    (async () => {
      // Initialize i18n (will load locale and subscribe to changes)
      await initLocale();

      // Load initial system info and pinned apps
      loadSystemInfo();
      loadPinnedApps();
      loadCurrentUser();
      loadPowerCapabilities();

      try {
        // Subscribe to events
        await window.edenAPI.subscribe("process/launched", handleAppLifecycle);
        await window.edenAPI.subscribe("process/stopped", handleAppLifecycle);
      } catch (error) {
        console.error("Failed to subscribe to events:", error);
      }
    })();
  });

  return (
    <div
      ref={overlayElement}
      class="shell-overlay"
      data-mode={isFullscreen() ? "fullscreen" : "dock"}
    >
      {/* AllApps appears above the dock when active */}
      <Show when={showAllApps() && !sessionTransition.visible()}>
        <AllApps
          apps={allApps()}
          onClose={handleShowAllApps}
          onAppClick={handleAppClick}
          appMenu={appMenu}
        />
      </Show>

      {/* Dock hidden when AllApps or ChangePassword dialog is open */}
      <Show when={!isFullscreen()}>
        <Dock
          runningApps={dockRunningApps()}
          pinnedApps={dockPinnedApps()}
          currentUser={currentUser()}
          onAppClick={handleAppClick}
          onShowAllApps={handleShowAllApps}
          userMenu={userContextMenu}
          appMenu={appMenu}
        />
      </Show>

      <Show when={isFullscreen() && !sessionTransition.visible()}>
        <div class="shell-overlay-keyboard-fab">
          <KeyboardButton label={t("shell.toggleKeyboard")} />
        </div>
      </Show>

      <Show when={sessionTransition.visible()}>
        <SessionTransitionOverlay
          action={sessionTransition.action()}
          snapshot={sessionTransition.snapshot()}
          error={sessionTransition.error()}
          onRetry={sessionTransition.retry}
          onDismiss={sessionTransition.dismiss}
        />
      </Show>

      <DialogHost dialogs={dialogs} />
    </div>
  );
}

import { Show, createSignal, onMount } from "solid-js";
import { FaSolidStop, FaSolidFire, FaSolidBolt, FaSolidThumbtack, FaSolidPlus, FaSolidTrash } from "solid-icons/fa";

export interface ContextMenuData {
  appId: string;
  appName: string;
  isRunning: boolean;
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

interface AppContextMenuProps {
  menu: ContextMenuData;
  isAppPinned: (appId: string) => boolean;
  onStopApp: (appId: string) => Promise<void> | void;
  onAddToDock: (appId: string) => Promise<void> | void;
  onRemoveFromDock: (appId: string) => Promise<void> | void;
  onUninstallApp: (appId: string) => Promise<void> | void;
  onClose: () => void;
}

/**
 * Render a context menu for an app, providing controls to stop the app, toggle hot reload, add/remove the app from the dock, and uninstall the app.
 *
 * @param props - Properties for the context menu including the target app information and action handlers:
 *   - menu.appId: the app's identifier
 *   - menu.appName: the app's display name
 *   - menu.isRunning: whether the app is currently running
 *   - optional menu.left/right/top/bottom: position offsets in pixels for the popover
 *   - isAppPinned(appId): returns whether the app is pinned to the dock
 *   - onStopApp(appId), onAddToDock(appId), onRemoveFromDock(appId), onUninstallApp(appId): action handlers
 *   - onClose(): closes the context menu
 * @returns The JSX for the app context menu popover and its overlay.
 */
export default function AppContextMenu(props: AppContextMenuProps) {
  const [hotReloadEnabled, setHotReloadEnabled] = createSignal(false);

  onMount(async () => {
    // Check hot reload status for this app
    try {
      const result = await window.edenAPI.shellCommand(
        "package/is-hot-reload-enabled",
        { appId: props.menu.appId }
      );
      if (result.enabled) {
        setHotReloadEnabled(true);
      }
    } catch (error) {
      console.error("Failed to check hot reload status:", error);
    }
  });

  const handleToggleHotReload = async () => {
    try {
      const result = await window.edenAPI.shellCommand(
        "package/toggle-hot-reload",
        { appId: props.menu.appId }
      );
      setHotReloadEnabled(result.enabled);
    } catch (error) {
      console.error("Failed to toggle hot reload:", error);
    }
    props.onClose();
  };

  const handleToggleDock = async () => {
    if (props.isAppPinned(props.menu.appId)) {
      await props.onRemoveFromDock(props.menu.appId);
    } else {
      await props.onAddToDock(props.menu.appId);
    }
    props.onClose();
  };

  const handleStopApp = async () => {
    await props.onStopApp(props.menu.appId);
    props.onClose();
  };

  const handleUninstall = async () => {
    await props.onUninstallApp(props.menu.appId);
    props.onClose();
  };

  return (
    <>
      <div
        class="eden-modal-overlay context-menu-overlay"
        onClick={props.onClose}
      />
      <div
        class="eden-popover"
        style={{
          ...(props.menu.left !== undefined && { left: `${props.menu.left}px` }),
          ...(props.menu.right !== undefined && { right: `${props.menu.right}px` }),
          ...(props.menu.top !== undefined && { top: `${props.menu.top}px` }),
          ...(props.menu.bottom !== undefined && { bottom: `${props.menu.bottom}px` }),
        }}
      >
        <div class="eden-popover-title context-menu-title">
          {props.menu.appName}
        </div>
        <Show when={props.menu.isRunning}>
          <button
            class="eden-btn eden-btn-ghost eden-btn-sm context-menu-btn"
            onClick={handleStopApp}
          >
            <FaSolidStop />
            Stop App
          </button>
        </Show>
        <button
          class="eden-btn eden-btn-ghost eden-btn-sm context-menu-btn"
          onClick={handleToggleHotReload}
        >
          {hotReloadEnabled() ? <FaSolidFire /> : <FaSolidBolt />}
          {hotReloadEnabled() ? "Disable" : "Enable"} Hot Reload
        </button>
        <button
          class="eden-btn eden-btn-ghost eden-btn-sm context-menu-btn"
          onClick={handleToggleDock}
        >
          {props.isAppPinned(props.menu.appId) ? <FaSolidThumbtack /> : <FaSolidPlus />}
          {props.isAppPinned(props.menu.appId) ? "Remove from Dock" : "Add to Dock"}
        </button>
        <button
          class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-danger context-menu-btn"
          onClick={handleUninstall}
        >
          <FaSolidTrash />
          Uninstall
        </button>
      </div>
    </>
  );
}
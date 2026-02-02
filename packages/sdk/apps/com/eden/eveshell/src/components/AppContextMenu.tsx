import { Show, createSignal, onMount } from "solid-js";
import { FaSolidStop, FaSolidFire, FaSolidBolt, FaSolidThumbtack, FaSolidPlus } from "solid-icons/fa";
import { t } from "../i18n";

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
  onClose: () => void;
}

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
            {t("shell.stopApp")}
          </button>
        </Show>
        <button
          class="eden-btn eden-btn-ghost eden-btn-sm context-menu-btn"
          onClick={handleToggleHotReload}
        >
          {hotReloadEnabled() ? <FaSolidFire /> : <FaSolidBolt />}
          {hotReloadEnabled() ? t("shell.disableHotReload") : t("shell.enableHotReload")}
        </button>
        <button
          class="eden-btn eden-btn-ghost eden-btn-sm context-menu-btn"
          onClick={handleToggleDock}
        >
          {props.isAppPinned(props.menu.appId) ? <FaSolidThumbtack /> : <FaSolidPlus />}
          {props.isAppPinned(props.menu.appId) ? t("shell.removeFromDock") : t("shell.addToDock")}
        </button>
      </div>
    </>
  );
}

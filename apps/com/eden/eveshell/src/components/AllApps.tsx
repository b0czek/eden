import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import AppIcon from "./AppIcon";
import { AppInfo } from "../types";

interface AllAppsProps {
  apps: AppInfo[];
  onClose: () => void;
  onAppClick: (appId: string) => Promise<void> | void;
  onStopApp: (appId: string) => Promise<void> | void;
  onUninstallApp: (appId: string) => Promise<void> | void;
}

export default function AllApps(props: AllAppsProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  const [contextMenu, setContextMenu] = createSignal<{
    appId: string;
    appName: string;
    isRunning: boolean;
    x: number;
    y: number;
  } | null>(null);
  const [hotReloadApps, setHotReloadApps] = createSignal<Set<string>>(
    new Set()
  );
  const [longPressTimer, setLongPressTimer] = createSignal<number | null>(null);
  const [isClosing, setIsClosing] = createSignal(false);
  const EXIT_ANIMATION_MS = 280;
  let exitTimer: number | undefined;
  let searchInputRef: HTMLInputElement | undefined;

  const filteredApps = () => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return props.apps;
    return props.apps.filter(
      (app) =>
        app.name.toLowerCase().includes(query) ||
        app.id.toLowerCase().includes(query)
    );
  };

  onMount(async () => {
    searchInputRef?.focus();

    const hotReloadSet = new Set<string>();
    for (const app of props.apps) {
      try {
        const result = await window.edenAPI!.shellCommand(
          "package/is-hot-reload-enabled",
          { appId: app.id }
        );
        if (result.enabled) {
          hotReloadSet.add(app.id);
        }
      } catch (error) {
        console.error(
          `Failed to check hot reload status for ${app.id}:`,
          error
        );
      }
    }
    setHotReloadApps(hotReloadSet);
  });

  onCleanup(() => {
    const timer = longPressTimer();
    if (timer) clearTimeout(timer);
    if (exitTimer) clearTimeout(exitTimer);
  });

  function clearLongPressTimer() {
    const timer = longPressTimer();
    if (timer) {
      clearTimeout(timer);
      setLongPressTimer(null);
    }
  }

  function triggerClose() {
    if (isClosing()) return;
    setContextMenu(null);
    setIsClosing(true);
    exitTimer = window.setTimeout(() => {
      props.onClose();
      exitTimer = undefined;
    }, EXIT_ANIMATION_MS);
  }

  function handleOverlayClick() {
    if (isClosing()) return;
    triggerClose();
  }

  async function handleTileClick(appId: string) {
    if (!isClosing()) triggerClose();

    // Show all running apps when clicking a tile
    const runningAppIds = props.apps
      .filter((app) => app.isRunning)
      .map((app) => app.id);
    for (const runningAppId of runningAppIds) {
      try {
        await window.edenAPI!.shellCommand("view/set-view-visibility", {
          appId: runningAppId,
          visible: true,
        });
      } catch (error) {
        console.error(`Failed to set visibility for ${runningAppId}:`, error);
      }
    }

    await props.onAppClick(appId);
  }

  function handleContextMenu(
    e: MouseEvent,
    appId: string,
    appName: string,
    isRunning: boolean
  ) {
    if (isClosing()) return;
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ appId, appName, isRunning, x: e.clientX, y: e.clientY });
  }

  function handleLongPressStart(
    e: TouchEvent | MouseEvent,
    appId: string,
    appName: string,
    isRunning: boolean
  ) {
    if (isClosing()) return;
    const timer = window.setTimeout(() => {
      const clientX =
        "touches" in e ? e.touches[0].clientX : (e as MouseEvent).clientX;
      const clientY =
        "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
      setContextMenu({ appId, appName, isRunning, x: clientX, y: clientY });
    }, 500);
    setLongPressTimer(timer);
  }

  function handleLongPressEnd() {
    clearLongPressTimer();
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") triggerClose();
  }

  return (
    <>
      {/* Main overlay - uses eden-modal-overlay but without blur */}
      <div
        class="eden-modal-overlay"
        classList={{ closing: isClosing() }}
        style="background: rgba(0,0,0,0.4); backdrop-filter: none;"
        onClick={handleOverlayClick}
        onKeyDown={handleKeyDown}
      >
        {/* Floating island - uses eden-modal as base */}
        <div
          class="eden-modal eden-modal-lg"
          classList={{ closing: isClosing() }}
          style="max-height: 70vh; background: var(--eden-color-surface-primary);"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header with search */}
          <div class="eden-modal-header">
            <div class="eden-flex eden-gap-sm" style="flex: 1;">
              <input
                ref={searchInputRef}
                type="text"
                class="eden-input"
                placeholder="Search apps..."
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
              />
            </div>
          </div>

          {/* App grid - uses eden-modal-body for scrolling */}
          <div class="eden-modal-body eden-scrollbar">
            <div class="eden-card-grid" style="gap: var(--eden-space-lg);">
              <For each={filteredApps()}>
                {(app) => (
                  <div
                    class="all-apps-tile eden-interactive"
                    classList={{ running: app.isRunning }}
                    onClick={async () => {
                      if (contextMenu() || isClosing()) return;
                      await handleTileClick(app.id);
                    }}
                    onContextMenu={(e) =>
                      handleContextMenu(e, app.id, app.name, app.isRunning)
                    }
                    onMouseDown={(e) => {
                      if (e.button === 0) {
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
                      isRunning={app.isRunning}
                    />
                  </div>
                )}
              </For>
              <Show when={filteredApps().length === 0}>
                <div
                  class="eden-text-tertiary eden-text-md"
                  style="grid-column: 1 / -1; text-align: center; padding: var(--eden-space-2xl);"
                >
                  No apps found
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>

      {/* Context menu */}
      <Show when={contextMenu()}>
        {(menu) => (
          <>
            <div
              class="eden-modal-overlay"
              style="background: transparent; backdrop-filter: none;"
              onClick={() => setContextMenu(null)}
            />
            <div
              class="eden-popover"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <div
                class="eden-popover-title"
                style="border-bottom: 1px solid var(--eden-color-border-light); padding-bottom: var(--eden-space-xs); margin-bottom: var(--eden-space-xs);"
              >
                {menu().appName}
              </div>
              <Show when={menu().isRunning}>
                <button
                  class="eden-btn eden-btn-ghost eden-btn-sm"
                  style="justify-content: flex-start; width: 100%;"
                  onClick={async () => {
                    await props.onStopApp(menu().appId);
                    setContextMenu(null);
                  }}
                >
                  <span class="eden-icon">■</span>
                  Stop App
                </button>
              </Show>
              <button
                class="eden-btn eden-btn-ghost eden-btn-sm"
                style="justify-content: flex-start; width: 100%;"
                onClick={async () => {
                  try {
                    const result = await window.edenAPI!.shellCommand(
                      "package/toggle-hot-reload",
                      { appId: menu().appId }
                    );
                    const newSet = new Set(hotReloadApps());
                    if (result.enabled) {
                      newSet.add(menu().appId);
                    } else {
                      newSet.delete(menu().appId);
                    }
                    setHotReloadApps(newSet);
                  } catch (error) {
                    console.error("Failed to toggle hot reload:", error);
                  }
                  setContextMenu(null);
                }}
              >
                <span class="eden-icon">
                  {hotReloadApps().has(menu().appId) ? "🔥" : "⚡"}
                </span>
                {hotReloadApps().has(menu().appId) ? "Disable" : "Enable"} Hot
                Reload
              </button>
              <button
                class="eden-btn eden-btn-ghost eden-btn-sm eden-btn-danger"
                style="justify-content: flex-start; width: 100%;"
                onClick={async () => {
                  await props.onUninstallApp(menu().appId);
                  setContextMenu(null);
                }}
              >
                <span class="eden-icon">×</span>
                Uninstall
              </button>
            </div>
          </>
        )}
      </Show>
    </>
  );
}

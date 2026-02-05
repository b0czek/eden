import { For, Show, createSignal, onMount } from "solid-js";
import AppIcon from "./AppIcon";
import { AppInfo } from "../types";
import { t } from "../i18n";
import { contextMenu, type Menu } from "@edenapp/tablets";

interface AllAppsProps {
  apps: AppInfo[];
  onClose: () => void;
  onAppClick: (appId: string) => Promise<void> | void;
  appMenu: Menu<AppInfo>;
}

export default function AllApps(props: AllAppsProps) {
  const [searchQuery, setSearchQuery] = createSignal("");
  let searchInputRef: HTMLInputElement | undefined;

  const filteredApps = () => {
    const query = searchQuery().toLowerCase().trim();
    if (!query) return props.apps;
    return props.apps.filter(
      (app) =>
        app.name.toLowerCase().includes(query) ||
        app.id.toLowerCase().includes(query),
    );
  };

  onMount(() => {
    searchInputRef?.focus();
  });

  function handleClose() {
    void contextMenu.close();
    props.onClose();
  }

  async function handleTileClick(appId: string) {
    handleClose();

    // Show all running apps when clicking a tile
    const runningAppIds = props.apps
      .filter((app) => app.isRunning)
      .map((app) => app.id);
    for (const runningAppId of runningAppIds) {
      try {
        await window.edenAPI.shellCommand("view/set-view-visibility", {
          appId: runningAppId,
          visible: true,
        });
      } catch (error) {
        console.error(`Failed to set visibility for ${runningAppId}:`, error);
      }
    }

    await props.onAppClick(appId);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") handleClose();
  }

  return (
    <>
      {/* Main overlay - uses eden-modal-overlay but without blur */}
      <div
        class="eden-modal-overlay"
        style="background: rgba(0,0,0,0.4); backdrop-filter: none;"
        onClick={handleClose}
        onKeyDown={handleKeyDown}
      >
        {/* Floating island - uses eden-modal as base */}
        <div
          class="eden-modal eden-modal-lg"
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
                placeholder={t("shell.searchApps")}
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
                    onClick={() => handleTileClick(app.id)}
                    onContextMenu={props.appMenu.handler(app)}
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
                  {t("shell.noAppsFound")}
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

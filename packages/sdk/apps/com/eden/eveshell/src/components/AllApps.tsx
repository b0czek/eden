import { contextMenu, type Menu } from "@edenapp/tablets";
import { createSignal, For, onMount, Show } from "solid-js";
import { t } from "../i18n";
import type { AppInfo } from "../types";
import AppIcon from "./AppIcon";

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

    await props.onAppClick(appId);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") handleClose();
  }

  return (
    <div
      class="eden-modal-overlay"
      style="background: rgba(0,0,0,0.4); backdrop-filter: none;"
    >
      <button
        type="button"
        class="all-apps-backdrop"
        aria-label={t("common.close")}
        onClick={handleClose}
      />
      <div
        class="eden-modal eden-modal-lg"
        style="max-height: 70vh; background: var(--eden-color-surface-primary);"
        role="dialog"
        aria-modal="true"
        aria-label={t("shell.allApps")}
        onKeyDown={handleKeyDown}
      >
        {/* App grid - uses eden-modal-body for scrolling */}
        <div class="eden-modal-body eden-scrollbar">
          <div class="eden-card-grid" style="gap: var(--eden-space-lg);">
            <For each={filteredApps()}>
              {(app) => (
                <button
                  type="button"
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
                </button>
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

        {/* Keep search beside the OSK so focusing it lifts the drawer into view */}
        <div class="eden-modal-footer">
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
    </div>
  );
}

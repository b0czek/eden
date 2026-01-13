import { createSignal, onMount, For, Show } from "solid-js";
import type { Component } from "solid-js";
import type { AppManifest } from "@edenapp/types";
import { FiTrash2, FiPackage, FiCpu } from "solid-icons/fi";
import { t, locale, getLocalizedValue } from "../i18n";

const AppsTab: Component = () => {
  const [apps, setApps] = createSignal<AppManifest[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [uninstalling, setUninstalling] = createSignal<string | null>(null);
  const [appIcons, setAppIcons] = createSignal<Record<string, string>>({});

  const loadApps = async () => {
    try {
      setLoading(true);
      const result = await window.edenAPI!.shellCommand("package/list", { showHidden: true });
      setApps(result);
      
      // Load icons
      const icons: Record<string, string> = {};
      for (const app of result) {
        try {
          const iconResult = await window.edenAPI!.shellCommand("package/get-icon", { appId: app.id });
          if (iconResult.icon) {
            icons[app.id] = iconResult.icon;
          }
        } catch {
          // Ignore icon load failures
        }
      }
      setAppIcons(icons);
    } catch (err) {
      console.error("Failed to load apps", err);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadApps();
  });

  const handleUninstall = async (appId: string, event: MouseEvent) => {
    event.stopPropagation();
    if (!confirm(t("settings.apps.uninstallConfirm"))) return;
    
    try {
      setUninstalling(appId);
      await window.edenAPI!.shellCommand("package/uninstall", { appId });
      await loadApps();
    } catch (err) {
      console.error("Failed to uninstall app", err);
      // Ideally show a toast
    } finally {
      setUninstalling(null);
    }
  };

  const installedApps = () => apps().filter(a => !a.isPrebuilt);
  const builtinApps = () => apps().filter(a => a.isPrebuilt);

  return (
    <div class="eden-flex-col eden-gap-lg" style={{ flex: 1, "min-height": 0 }}>

      <div class="settings-list">
        <Show when={!loading()} fallback={<div class="loading">{t("common.loading")}</div>}>
          
          {/* User Installed Apps */}
          <div class="eden-flex-between eden-py-sm">
             <h3 class="eden-text-lg eden-font-bold">{t("settings.apps.installedApps")}</h3>
             <span class="eden-badge">{installedApps().length}</span>
          </div>
          
          <Show when={installedApps().length > 0} fallback={
            <div class="empty-state">
              <div class="empty-state-icon">📦</div>
              <div class="empty-state-text">{t("settings.apps.noUserApps")}</div>
            </div>
          }>
            <div class="eden-flex-col eden-gap-md">
              <For each={installedApps()}>
                {(app) => (
                  <div class="setting-item eden-animate-fade-in">
                    <div class="eden-flex eden-items-center eden-gap-lg" style={{ flex: 1 }}>
                      <div class={appIcons()[app.id] ? "app-item-icon app-item-icon-no-bg" : "app-item-icon"}>
                         <Show when={appIcons()[app.id]} fallback={<FiPackage size={24} />}>
                            <img src={appIcons()[app.id]} alt={getLocalizedValue(app.name, locale())} />
                         </Show>
                      </div>
                      <div class="setting-info">
                        <h4 class="setting-label">{getLocalizedValue(app.name, locale())} <span class="eden-text-xs eden-text-tertiary eden-ml-sm">v{app.version}</span></h4>
                        <p class="setting-description">{app.description || t("settings.apps.noDescription")}</p>
                        <div class="eden-text-xs eden-text-tertiary eden-mt-xs eden-font-mono">{app.id}</div>
                      </div>
                    </div>
                    <div class="setting-control">
                      <button 
                        class="eden-btn eden-btn-danger eden-btn-md"
                        disabled={uninstalling() === app.id}
                        onClick={(e) => handleUninstall(app.id, e)}
                        title={t("settings.apps.uninstallApp")}
                      >
                         <Show when={uninstalling() === app.id} fallback={<FiTrash2 />}>
                           ...
                         </Show>
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* System Apps */}
          <div class="eden-flex-between eden-py-sm eden-mt-xl">
             <h3 class="eden-text-lg eden-font-bold">{t("settings.apps.systemApps")}</h3>
             <span class="eden-badge">{builtinApps().length}</span>
          </div>

          <div class="eden-flex-col eden-gap-md">
            <For each={builtinApps()}>
              {(app) => (
                <div class="setting-item eden-animate-fade-in eden-opacity-80">
                  <div class="eden-flex eden-items-center eden-gap-lg" style={{ flex: 1 }}>
                      <div class={appIcons()[app.id] ? "app-item-icon app-item-icon-no-bg" : "app-item-icon"}>
                         <Show when={appIcons()[app.id]} fallback={<FiCpu size={24} />}>
                            <img src={appIcons()[app.id]} alt={getLocalizedValue(app.name, locale())} />
                         </Show>
                      </div>
                    <div class="setting-info">
                      <h4 class="setting-label">{getLocalizedValue(app.name, locale())} <span class="eden-text-xs eden-text-tertiary eden-ml-sm">v{app.version}</span></h4>
                      <p class="setting-description">{app.description || t("settings.apps.systemComponent")}</p>
                      <div class="eden-text-xs eden-text-tertiary eden-mt-xs eden-font-mono">{app.id}</div>
                    </div>
                  </div>
                  <div class="setting-control">
                    <span class="eden-badge eden-badge-info">{t("settings.apps.builtin")}</span>
                  </div>
                </div>
              )}
            </For>
          </div>

        </Show>
      </div>
    </div>
  );
};

export default AppsTab;

import type { RuntimeAppManifest } from "@edenapp/types";
import { FiChevronRight, FiCpu, FiPackage } from "solid-icons/fi";
import type { Accessor, Component } from "solid-js";
import { createMemo, createSignal, For, Show } from "solid-js";
import { getLocalizedValue, locale, t } from "../../i18n";
import type { LoadedPanel, PanelAction } from "../../types";
import AppDetail from "./AppDetail";
import "./AppsTab.css";

interface AppPanelItem {
  manifest: RuntimeAppManifest;
  icon?: string;
  size?: number;
  hotReload: boolean;
  autostart: boolean;
}

interface AppsPanelData {
  apps: AppPanelItem[];
  development: boolean;
}

const AppsTab: Component<{
  panel: LoadedPanel;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}> = (props) => {
  const [selectedAppId, setSelectedAppId] = createSignal<string | null>(null);
  const data = () => props.panel.state.data as unknown as AppsPanelData;
  const sortedApps = createMemo(() =>
    [...(data()?.apps ?? [])].sort((a, b) =>
      getLocalizedValue(a.manifest.name, locale()).localeCompare(
        getLocalizedValue(b.manifest.name, locale()),
      ),
    ),
  );
  const selected = createMemo(
    () =>
      data()?.apps.find((item) => item.manifest.id === selectedAppId()) ?? null,
  );
  const run = (actionId: string, appId: string, extra = {}) =>
    props.onAction(actionId, {
      appId,
      ...extra,
    } as import("@edenapp/types").SettingsPanelValue);

  return (
    <div class="apps-management eden-flex-col">
      <Show
        when={selected()}
        fallback={
          <div class="eden-list">
            <For each={sortedApps()}>
              {(item) => (
                <button
                  type="button"
                  class="eden-list-item eden-list-item-interactive"
                  onClick={() => setSelectedAppId(item.manifest.id)}
                >
                  <div class="eden-list-item-icon">
                    <Show
                      when={item.icon}
                      fallback={
                        <div class="eden-avatar eden-avatar-md">
                          <Show
                            when={item.manifest.isPrebuilt}
                            fallback={<FiPackage class="eden-avatar-icon" />}
                          >
                            <FiCpu class="eden-avatar-icon" />
                          </Show>
                        </div>
                      }
                    >
                      <img
                        class="app-list-icon-img"
                        src={item.icon}
                        alt={getLocalizedValue(item.manifest.name, locale())}
                      />
                    </Show>
                  </div>
                  <div class="eden-list-item-content">
                    <div class="eden-list-item-title">
                      {getLocalizedValue(item.manifest.name, locale())}
                    </div>
                    <div class="eden-list-item-description">
                      v{item.manifest.version}
                    </div>
                  </div>
                  <Show when={item.manifest.isPrebuilt}>
                    <span class="eden-badge eden-badge-info eden-badge-sm">
                      {t("settings.apps.builtin")}
                    </span>
                  </Show>
                  <div class="eden-list-item-meta">
                    <FiChevronRight />
                  </div>
                </button>
              )}
            </For>
          </div>
        }
      >
        {(item) => (
          <AppDetail
            app={item().manifest}
            appIcon={item().icon}
            autostart={item().autostart}
            hotReload={item().hotReload}
            devMode={data().development}
            sizeLoading={false}
            size={item().size}
            uninstalling={props.busyActions().has("uninstall")}
            onBack={() => setSelectedAppId(null)}
            onAutostartToggle={(enabled) =>
              void run("set-autostart", item().manifest.id, { enabled })
            }
            onHotReloadToggle={() =>
              void run("toggle-hot-reload", item().manifest.id)
            }
            onUninstall={(event) => {
              event.stopPropagation();
              if (!confirm(t("settings.apps.uninstallConfirm"))) return;
              void run("uninstall", item().manifest.id).then((result) => {
                if (result.success) setSelectedAppId(null);
              });
            }}
          />
        )}
      </Show>
    </div>
  );
};

export default AppsTab;

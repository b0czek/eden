import type {
  RuntimeAppManifest,
  RuntimeDlcManifest,
  SettingsPanelValue,
} from "@edenapp/types";
import { FiChevronRight, FiCpu, FiPackage } from "solid-icons/fi";
import type { Accessor, Component } from "solid-js";
import { createEffect, createMemo, createSignal, For, Show } from "solid-js";
import { getLocalizedValue, locale, t } from "../../i18n";
import type { LoadedPanel, PanelAction } from "../../types";
import AppDetail from "./AppDetail";
import DlcDetail from "./DlcDetail";
import "./AppsTab.css";

interface AppPanelItem {
  manifest: RuntimeAppManifest;
  icon?: string;
  hotReload: boolean;
  autostart: boolean;
}

interface DlcPanelItem {
  manifest: RuntimeDlcManifest;
  icon?: string;
}

interface AppsPanelData {
  apps: AppPanelItem[];
  dlcs: DlcPanelItem[];
  development: boolean;
}

type Selection = { kind: "app" | "dlc"; id: string };

const AppsTab: Component<{
  panel: LoadedPanel;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}> = (props) => {
  const [selection, setSelection] = createSignal<Selection | null>(null);
  const [sizes, setSizes] = createSignal<Record<string, number | undefined>>(
    {},
  );
  const [sizeLoading, setSizeLoading] = createSignal<Record<string, boolean>>(
    {},
  );
  const loadedSizes = new Set<string>();
  const data = () => props.panel.state.data as unknown as AppsPanelData;
  const apps = createMemo(() =>
    [...(data()?.apps ?? [])].sort((a, b) =>
      getLocalizedValue(a.manifest.name, locale()).localeCompare(
        getLocalizedValue(b.manifest.name, locale()),
      ),
    ),
  );
  const dlcs = createMemo(() =>
    [...(data()?.dlcs ?? [])].sort((a, b) =>
      getLocalizedValue(a.manifest.name, locale()).localeCompare(
        getLocalizedValue(b.manifest.name, locale()),
      ),
    ),
  );
  const selectedApp = createMemo(() => {
    const selected = selection();
    return selected?.kind === "app"
      ? (data().apps.find((item) => item.manifest.id === selected.id) ?? null)
      : null;
  });
  const selectedDlc = createMemo(() => {
    const selected = selection();
    return selected?.kind === "dlc"
      ? (data().dlcs.find((item) => item.manifest.id === selected.id) ?? null)
      : null;
  });
  const run = (actionId: string, values: Record<string, unknown>) =>
    props.onAction(actionId, values as SettingsPanelValue);
  const sizeKey = (selected: Selection) => `${selected.kind}:${selected.id}`;
  const loadSize = async (selected: Selection) => {
    const key = sizeKey(selected);
    if (loadedSizes.has(key) || sizeLoading()[key]) return;
    setSizeLoading((current) => ({ ...current, [key]: true }));
    try {
      const result = await window.edenAPI.shellCommand("package/get-size", {
        packageId: selected.id,
      });
      setSizes((current) => ({ ...current, [key]: result.size }));
    } finally {
      loadedSizes.add(key);
      setSizeLoading((current) => ({ ...current, [key]: false }));
    }
  };
  createEffect(() => {
    const selected = selection();
    if (selected) void loadSize(selected);
  });
  const hostName = (hostId: string) => {
    const host = data().apps.find((item) => item.manifest.id === hostId);
    return host ? getLocalizedValue(host.manifest.name, locale()) : hostId;
  };

  return (
    <div class="apps-management eden-flex-col">
      <Show when={!selection()}>
        <div class="eden-list">
          <For each={apps()}>
            {(item) => (
              <button
                type="button"
                class="eden-list-item eden-list-item-interactive"
                onClick={() =>
                  setSelection({ kind: "app", id: item.manifest.id })
                }
              >
                <div class="eden-list-item-icon">
                  <Show
                    when={item.icon}
                    fallback={
                      <div class="eden-avatar eden-avatar-md">
                        {item.manifest.isPrebuilt ? <FiCpu /> : <FiPackage />}
                      </div>
                    }
                  >
                    <img class="app-list-icon-img" src={item.icon} alt="" />
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
                <FiChevronRight class="eden-list-item-meta" />
              </button>
            )}
          </For>
          <For each={dlcs()}>
            {(item) => (
              <button
                type="button"
                class="eden-list-item eden-list-item-interactive"
                onClick={() =>
                  setSelection({ kind: "dlc", id: item.manifest.id })
                }
              >
                <div class="eden-list-item-icon">
                  <Show when={item.icon} fallback={<FiPackage />}>
                    <img class="app-list-icon-img" src={item.icon} alt="" />
                  </Show>
                </div>
                <div class="eden-list-item-content">
                  <div class="eden-list-item-title">
                    {getLocalizedValue(item.manifest.name, locale())}
                  </div>
                  <div class="eden-list-item-description">
                    {t("settings.apps.host")}:{" "}
                    {hostName(item.manifest.hostAppId)}
                  </div>
                </div>
                <span class="eden-badge eden-badge-primary eden-badge-sm">
                  {t("settings.apps.dlc")}
                </span>
                <FiChevronRight class="eden-list-item-meta" />
              </button>
            )}
          </For>
        </div>
      </Show>

      <Show when={selectedApp()} keyed>
        {(item) => {
          const key = `app:${item.manifest.id}`;
          const children = () =>
            data().dlcs.filter(
              (dlc) => dlc.manifest.hostAppId === item.manifest.id,
            );
          return (
            <AppDetail
              app={item.manifest}
              appIcon={item.icon}
              autostart={item.autostart}
              hotReload={item.hotReload}
              devMode={data().development}
              sizeLoading={sizeLoading()[key] ?? false}
              size={sizes()[key]}
              uninstalling={props.busyActions().has("uninstall-package")}
              onBack={() => setSelection(null)}
              onAutostartToggle={(enabled) =>
                void run("set-autostart", { appId: item.manifest.id, enabled })
              }
              onHotReloadToggle={() =>
                void run("toggle-hot-reload", { appId: item.manifest.id })
              }
              onUninstall={(event) => {
                event.stopPropagation();
                const childNames = children().map((dlc) =>
                  getLocalizedValue(dlc.manifest.name, locale()),
                );
                const message = childNames.length
                  ? `${t("settings.apps.uninstallCascade")}\n\n${childNames.join("\n")}`
                  : t("settings.apps.uninstallConfirm");
                if (!confirm(message)) return;
                void run("uninstall-package", {
                  packageId: item.manifest.id,
                }).then((result) => {
                  if (result.success) setSelection(null);
                });
              }}
            />
          );
        }}
      </Show>

      <Show when={selectedDlc()} keyed>
        {(item) => {
          const key = `dlc:${item.manifest.id}`;
          return (
            <DlcDetail
              dlc={item.manifest}
              icon={item.icon}
              hostName={hostName(item.manifest.hostAppId)}
              size={sizes()[key]}
              sizeLoading={sizeLoading()[key] ?? false}
              uninstalling={props.busyActions().has("uninstall-package")}
              onBack={() => setSelection(null)}
              onUninstall={() => {
                if (!confirm(t("settings.apps.uninstallDlcConfirm"))) return;
                void run("uninstall-package", {
                  packageId: item.manifest.id,
                }).then((result) => {
                  if (result.success) setSelection(null);
                });
              }}
            />
          );
        }}
      </Show>
    </div>
  );
};

export default AppsTab;

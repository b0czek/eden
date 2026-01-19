import {
  createSignal,
  onMount,
  For,
  Show,
  createEffect,
  createMemo,
} from "solid-js";
import type { Component } from "solid-js";
import type { AppManifest } from "@edenapp/types";
import { FiPackage, FiCpu } from "solid-icons/fi";
import { t, locale, getLocalizedValue } from "../../i18n";
import AppDetail from "./AppDetail";
import "./AppsTab.css";

const AppsTab: Component = () => {
  const [apps, setApps] = createSignal<AppManifest[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [uninstalling, setUninstalling] = createSignal<string | null>(null);
  const [appIcons, setAppIcons] = createSignal<Record<string, string>>({});
  const [autostartApps, setAutostartApps] = createSignal<
    Record<string, boolean>
  >({});
  const [selectedAppId, setSelectedAppId] = createSignal<string | null>(null);
  const [appSizes, setAppSizes] = createSignal<
    Record<string, number | undefined>
  >({});
  const [sizeLoading, setSizeLoading] = createSignal<Record<string, boolean>>(
    {}
  );

  const AUTOSTART_KEY_PREFIX = "autostart.";

  const loadApps = async () => {
    try {
      setLoading(true);
      const result = await window.edenAPI!.shellCommand("package/list", {
        showHidden: true,
      });
      setApps(result);

      await Promise.all([loadIcons(result), loadAutostartSettings(result)]);

      if (
        selectedAppId() &&
        !result.some((app) => app.id === selectedAppId())
      ) {
        setSelectedAppId(result[0]?.id ?? null);
      }
    } catch (err) {
      console.error("Failed to load apps", err);
    } finally {
      setLoading(false);
    }
  };

  onMount(() => {
    loadApps();
  });

  const loadIcons = async (result: AppManifest[]) => {
    const icons: Record<string, string> = {};
    for (const app of result) {
      try {
        const iconResult = await window.edenAPI!.shellCommand(
          "package/get-icon",
          { appId: app.id }
        );
        if (iconResult.icon) {
          icons[app.id] = iconResult.icon;
        }
      } catch {
        // Ignore icon load failures
      }
    }
    setAppIcons(icons);
  };

  const loadAutostartSettings = async (result: AppManifest[]) => {
    const values: Record<string, boolean> = {};
    try {
      const keysResult = await window.edenAPI!.shellCommand(
        "settings/list/su",
        {
          appId: "com.eden",
        }
      );
      const keys: string[] = keysResult.keys ?? [];
      const autostartKeys = keys.filter((key) =>
        key.startsWith(AUTOSTART_KEY_PREFIX)
      );

      await Promise.all(
        autostartKeys.map(async (key) => {
          const appId = key.slice(AUTOSTART_KEY_PREFIX.length);
          const valueResult = await window.edenAPI!.shellCommand(
            "settings/get/su",
            {
              appId: "com.eden",
              key,
            }
          );
          values[appId] = valueResult.value === "true";
        })
      );
    } catch (err) {
      console.error("Failed to load autostart settings", err);
    }

    for (const app of result) {
      if (values[app.id] === undefined) {
        values[app.id] = false;
      }
    }

    setAutostartApps(values);
  };

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

  const handleAutostartToggle = async (appId: string, enabled: boolean) => {
    setAutostartApps((current) => ({ ...current, [appId]: enabled }));

    try {
      await window.edenAPI!.shellCommand("settings/set/su", {
        appId: "com.eden",
        key: `${AUTOSTART_KEY_PREFIX}${appId}`,
        value: enabled ? "true" : "false",
      });
    } catch (err) {
      console.error("Failed to save autostart setting", err);
    }
  };

  const loadAppSize = async (appId: string) => {
    if (sizeLoading()[appId] || appSizes()[appId] !== undefined) {
      return;
    }

    setSizeLoading((current) => ({ ...current, [appId]: true }));
    try {
      const result = await window.edenAPI!.shellCommand("package/get-size", {
        appId,
      });
      setAppSizes((current) => ({ ...current, [appId]: result.size }));
    } catch (err) {
      console.error("Failed to load app size", err);
      setAppSizes((current) => ({ ...current, [appId]: undefined }));
    } finally {
      setSizeLoading((current) => ({ ...current, [appId]: false }));
    }
  };

  createEffect(() => {
    const appId = selectedAppId();
    if (appId) {
      loadAppSize(appId);
    }
  });

  const sortedApps = createMemo(() => {
    const appList = [...apps()];
    appList.sort((a, b) =>
      getLocalizedValue(a.name, locale()).localeCompare(
        getLocalizedValue(b.name, locale())
      )
    );
    return appList;
  });
  const selectedApp = createMemo(
    () => apps().find((app) => app.id === selectedAppId()) ?? null
  );

  return (
    <div
      class="apps-management eden-flex-col"
      style={{ flex: 1, "min-height": 0 }}
    >
      <Show
        when={!loading()}
        fallback={
          <div class="loading eden-flex-center">{t("common.loading")}</div>
        }
      >
        <Show
          when={selectedApp()}
          fallback={
            <section class="apps-list-screen eden-flex-col eden-gap-md eden-glass-strong eden-rounded-xl eden-p-sm">
              <div class="apps-list eden-flex-col eden-gap-xs eden-p-xs">
                <For each={sortedApps()}>
                  {(app) => (
                    <button
                      type="button"
                      class="app-row"
                      onClick={() => setSelectedAppId(app.id)}
                    >
                      <div
                        class={
                          appIcons()[app.id]
                            ? "app-row-icon app-row-icon-no-bg"
                            : "app-row-icon"
                        }
                      >
                        <Show
                          when={appIcons()[app.id]}
                          fallback={
                            app.isPrebuilt ? (
                              <FiCpu size={22} />
                            ) : (
                              <FiPackage size={22} />
                            )
                          }
                        >
                          <img
                            src={appIcons()[app.id]}
                            alt={getLocalizedValue(app.name, locale())}
                          />
                        </Show>
                      </div>
                      <div class="app-row-info">
                        <div class="app-row-title eden-text-sm eden-font-semibold">
                          {getLocalizedValue(app.name, locale())}
                        </div>
                        <div class="app-row-subtitle eden-text-xs eden-text-tertiary">
                          v{app.version}
                        </div>
                      </div>
                      <Show when={app.isPrebuilt}>
                        <span class="eden-badge eden-badge-info app-row-badge">
                          {t("settings.apps.builtin")}
                        </span>
                      </Show>
                    </button>
                  )}
                </For>
              </div>
            </section>
          }
        >
          {(app) => (
            <AppDetail
              app={app()}
              appIcon={appIcons()[app().id]}
              autostart={autostartApps()[app().id] === true}
              sizeLoading={sizeLoading()[app().id] ?? false}
              size={appSizes()[app().id]}
              uninstalling={uninstalling() === app().id}
              onBack={() => setSelectedAppId(null)}
              onAutostartToggle={(enabled) =>
                handleAutostartToggle(app().id, enabled)
              }
              onUninstall={(e) => handleUninstall(app().id, e)}
            />
          )}
        </Show>
      </Show>
    </div>
  );
};

export default AppsTab;

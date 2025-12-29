import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import type { Component } from "solid-js";
import type { AppManifest, SettingsCategory } from "@edenapp/types";
import { FiSettings, FiCode, FiPackage } from "solid-icons/fi";
import { VsSettings, VsSymbolColor, VsPulse } from "solid-icons/vs";
import SettingInput from "./components/SettingInput";
import "./App.css";

interface SelectedItem {
  type: "eden" | "app";
  id: string;
  label: string;
}

const App: Component = () => {
  const [apps, setApps] = createSignal<AppManifest[]>([]);
  const [appIcons, setAppIcons] = createSignal<Record<string, string>>({});
  const [edenSchema, setEdenSchema] = createSignal<SettingsCategory[]>([]);
  const [selectedItem, setSelectedItem] = createSignal<SelectedItem | null>(null);
  const [currentSettings, setCurrentSettings] = createSignal<SettingsCategory[]>([]);
  const [settingValues, setSettingValues] = createStore<Record<string, string>>({});
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    await Promise.all([loadEdenSchema(), loadApps()]);
    setLoading(false);
  });

  const loadEdenSchema = async () => {
    try {
      const result = await window.edenAPI!.shellCommand("settings/schema", {});
      setEdenSchema(result.schema);
    } catch (error) {
      console.error("Failed to load Eden schema:", error);
    }
  };

  const loadApps = async () => {
    try {
      const result = await window.edenAPI!.shellCommand("package/list", { showHidden: true });
      const appsWithSettings = result.filter((app: AppManifest) => 
        app.settings && app.settings.length > 0
      );
      setApps(appsWithSettings);

      const icons: Record<string, string> = {};
      for (const app of appsWithSettings) {
        try {
          const iconResult = await window.edenAPI!.shellCommand("package/get-icon", { appId: app.id });
          if (iconResult.icon) {
            icons[app.id] = iconResult.icon;
          }
        } catch {
          // Icon not available
        }
      }
      setAppIcons(icons);
    } catch (error) {
      console.error("Failed to load apps:", error);
    }
  };

  createEffect(() => {
    const item = selectedItem();
    if (!item) return;

    if (item.type === "eden") {
      loadEdenSettings(item.id);
    } else {
      loadAppSettings(item.id);
    }
  });

  const loadEdenSettings = async (categoryId: string) => {
    const schema = edenSchema();
    const category = schema.find((c) => c.id === categoryId);
    if (!category) return;

    setCurrentSettings([category]);

    const values: Record<string, string> = {};
    try {
      // Eden settings use appId "com.eden"
      const result = await window.edenAPI!.shellCommand("settings/get-all/su", { appId: "com.eden" });
      for (const setting of category.settings) {
        values[setting.key] = result.settings[setting.key] ?? setting.defaultValue ?? "";
      }
    } catch (error) {
      console.error("Failed to load Eden settings:", error);
      for (const setting of category.settings) {
        values[setting.key] = setting.defaultValue ?? "";
      }
    }

    setSettingValues(values);
  };

  const loadAppSettings = async (appId: string) => {
    const app = apps().find((a) => a.id === appId);
    if (!app?.settings) return;

    setCurrentSettings(app.settings);

    const values: Record<string, string> = {};
    try {
      const result = await window.edenAPI!.shellCommand("settings/get-all/su", { appId });
      for (const category of app.settings) {
        for (const setting of category.settings) {
          values[setting.key] = result.settings[setting.key] ?? setting.defaultValue ?? "";
        }
      }
    } catch (error) {
      console.error("Failed to load app settings:", error);
      for (const category of app.settings) {
        for (const setting of category.settings) {
          values[setting.key] = setting.defaultValue ?? "";
        }
      }
    }

    setSettingValues(values);
  };

  const handleSettingChange = async (key: string, value: string) => {
    setSettingValues(key, value);

    const item = selectedItem();
    if (!item) return;

    try {
      if (item.type === "eden") {
        // Eden settings use appId "com.eden"
        await window.edenAPI!.shellCommand("settings/set/su", {
          appId: "com.eden",
          key,
          value,
        });
      } else {
        await window.edenAPI!.shellCommand("settings/set/su", {
          appId: item.id,
          key,
          value,
        });
      }
    } catch (error) {
      console.error("Failed to save setting:", error);
    }
  };

  const handleSelectEdenCategory = (category: SettingsCategory) => {
    setSelectedItem({
      type: "eden",
      id: category.id,
      label: category.name,
    });
  };

  const handleSelectApp = (app: AppManifest) => {
    setSelectedItem({
      type: "app",
      id: app.id,
      label: app.name,
    });
  };

  const getCategoryIcon = (iconName?: string) => {
    switch (iconName) {
      case "palette":
        return <VsSymbolColor />;
      case "settings":
        return <VsPulse />;
      case "code":
        return <FiCode />;
      default:
        return <FiSettings />;
    }
  };

  return (
    <div class="settings-app">
      {/* Sidebar - using edencss sidebar component */}
      <aside class="eden-sidebar">
        <div class="eden-sidebar-section">
          <div class="eden-sidebar-section-title">Eden</div>
          <div class="eden-sidebar-items">
            <For each={edenSchema()}>
              {(category) => (
                <div
                  class={`eden-sidebar-item ${selectedItem()?.type === "eden" && selectedItem()?.id === category.id ? "eden-sidebar-item-selected" : ""}`}
                  onClick={() => handleSelectEdenCategory(category)}
                >
                  <div class="eden-sidebar-item-icon">
                    {getCategoryIcon(category.icon)}
                  </div>
                  <span class="eden-sidebar-item-text">{category.name}</span>
                </div>
              )}
            </For>
          </div>
        </div>

        <div class="eden-sidebar-divider" />

        <div class="eden-sidebar-section eden-sidebar-section-scrollable">
          <div class="eden-sidebar-section-title">Applications</div>
          <div class="eden-sidebar-items eden-sidebar-items-scrollable">
            <Show
              when={apps().length > 0}
              fallback={
                <div class="eden-sidebar-item eden-sidebar-item-disabled">
                  <div class="eden-sidebar-item-icon"><FiPackage /></div>
                  <span class="eden-sidebar-item-text">No apps with settings</span>
                </div>
              }
            >
              <For each={apps()}>
                {(app) => (
                  <div
                    class={`eden-sidebar-item ${selectedItem()?.type === "app" && selectedItem()?.id === app.id ? "eden-sidebar-item-selected" : ""}`}
                    onClick={() => handleSelectApp(app)}
                  >
                    <div class="eden-sidebar-item-icon">
                      <Show
                        when={appIcons()[app.id]}
                        fallback={<FiPackage />}
                      >
                        <img src={appIcons()[app.id]} alt="" />
                      </Show>
                    </div>
                    <span class="eden-sidebar-item-text">{app.name}</span>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main class="main-content">
        <Show
          when={!loading()}
          fallback={<div class="loading"><span class="loading-spinner">⟳</span> Loading...</div>}
        >
          <Show
            when={selectedItem()}
            fallback={
              <div class="empty-state">
                <div class="empty-state-icon"><VsSettings /></div>
                <div class="empty-state-text">Select a category from the sidebar</div>
              </div>
            }
          >
            {(item) => (
              <>
                <header class="content-header">
                  <h1 class="content-title">{item().label}</h1>
                  <Show when={item().type === "app"}>
                    <p class="content-description">{apps().find(a => a.id === item().id)?.description}</p>
                  </Show>
                </header>

                <div class="settings-list">
                  <For each={currentSettings()}>
                    {(category) => (
                      <>
                        <Show when={currentSettings().length > 1}>
                          <h3 class="category-header">{category.name}</h3>
                        </Show>
                        <For each={category.settings}>
                          {(setting) => (
                            <div class="setting-item">
                              <div class="setting-info">
                                <h4 class="setting-label">{setting.label}</h4>
                                <Show when={setting.description}>
                                  <p class="setting-description">{setting.description}</p>
                                </Show>
                              </div>
                              <SettingInput
                                setting={setting}
                                value={settingValues[setting.key] ?? setting.defaultValue ?? ""}
                                onChange={(value) => handleSettingChange(setting.key, value)}
                              />
                            </div>
                          )}
                        </For>
                      </>
                    )}
                  </For>
                </div>
              </>
            )}
          </Show>
        </Show>
      </main>
    </div>
  );
};

export default App;

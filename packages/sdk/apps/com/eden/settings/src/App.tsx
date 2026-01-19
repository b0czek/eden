import { createSignal, createEffect, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import type { Component } from "solid-js";
import type { AppManifest, SettingsCategory } from "@edenapp/types";
import SettingsSidebar from "./components/SettingsSidebar";
import SettingsContent from "./components/SettingsContent";
import { initLocale, locale, getLocalizedValue } from "./i18n";
import type { SelectedItem } from "./types";
import "./App.css";

const App: Component = () => {
  const [apps, setApps] = createSignal<AppManifest[]>([]);
  const [appIcons, setAppIcons] = createSignal<Record<string, string>>({});
  const [edenSchema, setEdenSchema] = createSignal<SettingsCategory[]>([]);
  const [selectedItem, setSelectedItem] = createSignal<SelectedItem | null>(
    null
  );
  const [currentSettings, setCurrentSettings] = createSignal<
    SettingsCategory[]
  >([]);
  const [settingValues, setSettingValues] = createStore<Record<string, string>>(
    {}
  );
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    await initLocale();
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
      const result = await window.edenAPI!.shellCommand("package/list", {
        showHidden: true,
      });
      const appsWithSettings = result.filter(
        (app: AppManifest) => app.settings && app.settings.length > 0
      );
      setApps(appsWithSettings);

      const icons: Record<string, string> = {};
      for (const app of appsWithSettings) {
        try {
          const iconResult = await window.edenAPI!.shellCommand(
            "package/get-icon",
            { appId: app.id }
          );
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
      const result = await window.edenAPI!.shellCommand("settings/get-all/su", {
        appId: "com.eden",
      });
      for (const setting of category.settings) {
        values[setting.key] =
          result.settings[setting.key] ?? setting.defaultValue ?? "";
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
      const result = await window.edenAPI!.shellCommand("settings/get-all/su", {
        appId,
      });
      for (const category of app.settings) {
        for (const setting of category.settings) {
          values[setting.key] =
            result.settings[setting.key] ?? setting.defaultValue ?? "";
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
      label: getLocalizedValue(category.name, locale()),
    });
  };

  const handleSelectApp = (app: AppManifest) => {
    setSelectedItem({
      type: "app",
      id: app.id,
      label: getLocalizedValue(app.name, locale()),
    });
  };

  return (
    <div class="settings-app">
      <SettingsSidebar
        edenSchema={edenSchema}
        apps={apps}
        appIcons={appIcons}
        selectedItem={selectedItem}
        onSelectEdenCategory={handleSelectEdenCategory}
        onSelectApp={handleSelectApp}
      />
      <SettingsContent
        loading={loading}
        selectedItem={selectedItem}
        edenSchema={edenSchema}
        apps={apps}
        currentSettings={currentSettings}
        settingValues={settingValues}
        onSettingChange={handleSettingChange}
      />
    </div>
  );
};

export default App;

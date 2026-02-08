import type { AppManifest, SettingsCategory } from "@edenapp/types";
import type { Component } from "solid-js";
import { createEffect, createSignal, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import SettingsContent from "./components/SettingsContent";
import SettingsSidebar from "./components/SettingsSidebar";
import { getLocalizedValue, initLocale, locale } from "./i18n";
import type { SelectedItem } from "./types";
import "./App.css";

const App: Component = () => {
  const [apps, setApps] = createSignal<AppManifest[]>([]);
  const [appIcons, setAppIcons] = createSignal<Record<string, string>>({});
  const [edenSchema, setEdenSchema] = createSignal<SettingsCategory[]>([]);
  const [selectedItem, setSelectedItem] = createSignal<SelectedItem | null>(
    null,
  );
  const [currentSettings, setCurrentSettings] = createSignal<
    SettingsCategory[]
  >([]);
  const [settingValues, setSettingValues] = createStore<Record<string, string>>(
    {},
  );
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    await initLocale();
    await Promise.all([loadEdenSchema(), loadApps()]);
    setLoading(false);
  });

  const loadEdenSchema = async () => {
    try {
      const result = await window.edenAPI.shellCommand("settings/schema", {});
      const schema = Array.isArray(result.schema) ? result.schema : [];
      setEdenSchema(schema);
    } catch (error) {
      console.error("Failed to load Eden schema:", error);
    }
  };

  const loadApps = async () => {
    let appsWithSettings: AppManifest[] = [];
    try {
      const result = await window.edenAPI.shellCommand("package/list", {
        showHidden: true,
      });
      appsWithSettings = result.filter(
        (app: AppManifest) => app.settings && app.settings.length > 0,
      );
      setApps(appsWithSettings);

      const icons: Record<string, string> = {};
      for (const app of appsWithSettings) {
        try {
          const iconResult = await window.edenAPI.shellCommand(
            "package/get-icon",
            { appId: app.id },
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
    } else if (item.type === "app") {
      loadAppSettings(item.id);
    }
  });

  createEffect(() => {
    const item = selectedItem();
    if (!item || item.type !== "eden") return;
    const exists = edenSchema().some((category) => category.id === item.id);
    if (!exists) {
      setSelectedItem(null);
      setCurrentSettings([]);
    }
  });

  const loadEdenSettings = async (categoryId: string) => {
    const schema = edenSchema();
    const category = schema.find((c) => c.id === categoryId);
    if (!category) return;

    if (category.view) {
      setCurrentSettings([]);
      setSettingValues({});
      return;
    }

    setCurrentSettings([category]);

    const values: Record<string, string> = {};
    try {
      // Eden settings use appId "com.eden"
      const result = await window.edenAPI.shellCommand("settings/get-all/su", {
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
      const result = await window.edenAPI.shellCommand("settings/get-all/su", {
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
        await window.edenAPI.shellCommand("settings/set/su", {
          appId: "com.eden",
          key,
          value,
        });
      } else if (item.type === "app") {
        await window.edenAPI.shellCommand("settings/set/su", {
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

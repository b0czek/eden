import type { AppManifest, SettingsCategory } from "@edenapp/types";
import { type Component, createSignal, onMount, Show } from "solid-js";
import UsersTab from "./components/users/UsersTab";
import { initLocale, t } from "./i18n";
import "./App.css";

const App: Component = () => {
  const [edenSchema, setEdenSchema] = createSignal<SettingsCategory[]>([]);
  const [apps, setApps] = createSignal<AppManifest[]>([]);
  const [loading, setLoading] = createSignal(true);

  const loadEdenSchema = async () => {
    try {
      const result = await window.edenAPI.shellCommand("settings/schema", {
        showRestricted: true,
      });
      setEdenSchema(Array.isArray(result.schema) ? result.schema : []);
    } catch (error) {
      console.error("Failed to load Eden schema:", error);
      setEdenSchema([]);
    }
  };

  const loadApps = async () => {
    try {
      const result = await window.edenAPI.shellCommand("package/list", {
        showHidden: true,
        showRestricted: true,
      });
      setApps(Array.isArray(result) ? result : []);
    } catch (error) {
      console.error("Failed to load apps:", error);
      setApps([]);
    }
  };

  onMount(async () => {
    await initLocale();
    await Promise.all([loadEdenSchema(), loadApps()]);
    setLoading(false);
  });

  return (
    <div class="users-app">
      <Show
        when={!loading()}
        fallback={
          <div class="loading">
            <span class="loading-spinner">⟳</span> {t("common.loading")}
          </div>
        }
      >
        <UsersTab edenSchema={edenSchema} apps={apps} />
      </Show>
    </div>
  );
};

export default App;

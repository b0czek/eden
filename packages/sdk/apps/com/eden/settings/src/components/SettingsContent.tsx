import { Match, Show, Switch, type Accessor, type Component } from "solid-js";
import type { Store } from "solid-js/store";
import type { AppManifest, SettingsCategory } from "@edenapp/types";
import { VsSettings } from "solid-icons/vs";
import AppsTab from "./apps";
import AppearanceTab from "./AppearanceTab";
import SettingsList from "./SettingsList";
import type { SelectedItem } from "../types";
import { getLocalizedValue, locale, t } from "../i18n";

interface SettingsContentProps {
  loading: Accessor<boolean>;
  selectedItem: Accessor<SelectedItem | null>;
  edenSchema: Accessor<SettingsCategory[]>;
  apps: Accessor<AppManifest[]>;
  currentSettings: Accessor<SettingsCategory[]>;
  settingValues: Store<Record<string, string>>;
  onSettingChange: (key: string, value: string) => void;
}

const SettingsContent: Component<SettingsContentProps> = (props) => {
  const getItemDescription = (item: SelectedItem) => {
    if (item.type === "app") {
      return props.apps().find((app) => app.id === item.id)?.description;
    }
    return getLocalizedValue(
      props.edenSchema().find((cat) => cat.id === item.id)?.description,
      locale()
    );
  };

  return (
    <main class="main-content">
      <Show
        when={!props.loading()}
        fallback={
          <div class="loading">
            <span class="loading-spinner">⟳</span> {t("common.loading")}
          </div>
        }
      >
        <Show
          when={props.selectedItem()}
          fallback={
            <div class="empty-state">
              <div class="empty-state-icon">
                <VsSettings />
              </div>
              <div class="empty-state-text">{t("settings.selectCategory")}</div>
            </div>
          }
        >
          {(item) => (
            <>
              <header class="content-header">
                <h1 class="content-title">{item().label}</h1>
                <Show when={getItemDescription(item())}>
                  {(desc) => <p class="content-description">{desc()}</p>}
                </Show>
              </header>

              <Switch>
                <Match when={item().type === "eden" && item().id === "apps"}>
                  <AppsTab />
                </Match>
                <Match when={item().id === "appearance"}>
                  <AppearanceTab />
                </Match>
                <Match when={true}>
                  <SettingsList
                    categories={props.currentSettings}
                    values={props.settingValues}
                    onSettingChange={props.onSettingChange}
                  />
                </Match>
              </Switch>
            </>
          )}
        </Show>
      </Show>
    </main>
  );
};

export default SettingsContent;

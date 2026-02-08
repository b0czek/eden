import type { AppManifest, SettingsCategory } from "@edenapp/types";
import { VsSettings } from "solid-icons/vs";
import { type Accessor, type Component, Show } from "solid-js";
import type { Store } from "solid-js/store";
import { Dynamic } from "solid-js/web";
import { getLocalizedValue, locale, t } from "../i18n";
import type { SelectedItem } from "../types";
import AppearanceTab from "./AppearanceTab";
import AppsTab from "./apps";
import SettingsList from "./SettingsList";

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
      locale(),
    );
  };

  const getSelectedCategory = () =>
    props.selectedItem()?.type === "eden"
      ? props.edenSchema().find((cat) => cat.id === props.selectedItem()?.id)
      : null;

  const getSelectedViewId = () => {
    const item = props.selectedItem();
    if (!item) return undefined;
    return getSelectedCategory()?.view;
  };

  const viewRegistry: Record<string, Component> = {
    apps: AppsTab,
    appearance: AppearanceTab,
  };

  const getViewComponent = () => {
    const viewId = getSelectedViewId();
    if (!viewId) return undefined;
    return viewRegistry[viewId];
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

              <Show
                when={getViewComponent()}
                fallback={
                  <SettingsList
                    categories={props.currentSettings}
                    values={props.settingValues}
                    onSettingChange={props.onSettingChange}
                  />
                }
              >
                {(ViewComponent) => <Dynamic component={ViewComponent()} />}
              </Show>
            </>
          )}
        </Show>
      </Show>
    </main>
  );
};

export default SettingsContent;

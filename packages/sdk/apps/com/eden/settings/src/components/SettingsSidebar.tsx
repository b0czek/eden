import { For, Show, type Accessor, type Component } from "solid-js";
import type { AppManifest, SettingsCategory } from "@edenapp/types";
import { FiSettings, FiCode, FiPackage, FiImage } from "solid-icons/fi";
import { VsSymbolColor, VsPulse } from "solid-icons/vs";
import type { SelectedItem } from "../types";
import { getLocalizedValue, locale, t } from "../i18n";

interface SettingsSidebarProps {
  edenSchema: Accessor<SettingsCategory[]>;
  apps: Accessor<AppManifest[]>;
  appIcons: Accessor<Record<string, string>>;
  selectedItem: Accessor<SelectedItem | null>;
  onSelectEdenCategory: (category: SettingsCategory) => void;
  onSelectApp: (app: AppManifest) => void;
}

const SettingsSidebar: Component<SettingsSidebarProps> = (props) => {
  const isSelected = (type: SelectedItem["type"], id: string) =>
    props.selectedItem()?.type === type && props.selectedItem()?.id === id
      ? "eden-sidebar-item-selected"
      : "";

  const getCategoryIcon = (iconName?: string) => {
    switch (iconName) {
      case "palette":
        return <VsSymbolColor />;
      case "settings":
        return <VsPulse />;
      case "code":
        return <FiCode />;
      case "image":
        return <FiImage />;
      case "package":
        return <FiPackage />;
      default:
        return <FiSettings />;
    }
  };

  return (
    <aside class="eden-sidebar">
      <div class="eden-sidebar-section">
        <div class="eden-sidebar-section-title">
          {t("settings.sidebar.eden")}
        </div>
        <div class="eden-sidebar-items">
          <For each={props.edenSchema()}>
            {(category) => (
              <div
                class={`eden-sidebar-item ${isSelected("eden", category.id)}`}
                onClick={() => props.onSelectEdenCategory(category)}
              >
                <div class="eden-sidebar-item-icon">
                  {getCategoryIcon(category.icon)}
                </div>
                <span class="eden-sidebar-item-text">
                  {getLocalizedValue(category.name, locale())}
                </span>
              </div>
            )}
          </For>
        </div>
      </div>

      <div class="eden-sidebar-divider" />

      <div class="eden-sidebar-section eden-sidebar-section-scrollable">
        <div class="eden-sidebar-section-title">
          {t("settings.sidebar.applications")}
        </div>
        <div class="eden-sidebar-items eden-sidebar-items-scrollable">
          <Show
            when={props.apps().length > 0}
            fallback={
              <div class="eden-sidebar-item eden-sidebar-item-disabled">
                <div class="eden-sidebar-item-icon">
                  <FiPackage />
                </div>
                <span class="eden-sidebar-item-text">
                  {t("settings.sidebar.noAppsWithSettings")}
                </span>
              </div>
            }
          >
            <For each={props.apps()}>
              {(app) => (
                <div
                  class={`eden-sidebar-item ${isSelected("app", app.id)}`}
                  onClick={() => props.onSelectApp(app)}
                >
                  <div class="eden-sidebar-item-icon">
                    <Show
                      when={props.appIcons()[app.id]}
                      fallback={<FiPackage />}
                    >
                      <img src={props.appIcons()[app.id]} alt="" />
                    </Show>
                  </div>
                  <span class="eden-sidebar-item-text">
                    {getLocalizedValue(app.name, locale())}
                  </span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </div>
    </aside>
  );
};

export default SettingsSidebar;

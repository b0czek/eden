import type { SettingsPanelSummary } from "@edenapp/types";
import { BiSolidKeyboard } from "solid-icons/bi";
import { FiCode, FiCpu, FiImage, FiPackage, FiSettings } from "solid-icons/fi";
import { VsPulse, VsSymbolColor } from "solid-icons/vs";
import { type Accessor, type Component, For, Show } from "solid-js";
import { getLocalizedValue, locale, t } from "../i18n";

interface SettingsSidebarProps {
  brandName: Accessor<string>;
  panels: Accessor<SettingsPanelSummary[]>;
  selectedPanelId: Accessor<string | null>;
  onSelect: (panelId: string) => void;
}

const SettingsSidebar: Component<SettingsSidebarProps> = (props) => {
  const systemPanels = () =>
    props.panels().filter((panel) => panel.source !== "application");
  const applicationPanels = () =>
    props.panels().filter((panel) => panel.source === "application");

  const icon = (panel: SettingsPanelSummary) => {
    if (panel.source === "application" && panel.icon) {
      return <img src={panel.icon} alt="" />;
    }
    switch (panel.icon) {
      case "palette":
        return <VsSymbolColor />;
      case "settings":
        return <VsPulse />;
      case "keyboard":
        return <BiSolidKeyboard />;
      case "code":
        return <FiCode />;
      case "image":
        return <FiImage />;
      case "package":
        return <FiPackage />;
      case "cpu":
        return <FiCpu />;
      default:
        return <FiSettings />;
    }
  };

  const item = (panel: SettingsPanelSummary) => (
    <button
      type="button"
      class={`eden-sidebar-item ${
        props.selectedPanelId() === panel.id ? "eden-sidebar-item-selected" : ""
      }`}
      onClick={() => props.onSelect(panel.id)}
    >
      <div class="eden-sidebar-item-icon">{icon(panel)}</div>
      <span class="eden-sidebar-item-text">
        {getLocalizedValue(panel.title, locale())}
      </span>
    </button>
  );

  return (
    <aside class="eden-sidebar">
      <div class="eden-sidebar-section">
        <div class="eden-sidebar-section-title">{props.brandName()}</div>
        <div class="eden-sidebar-items">
          <For each={systemPanels()}>{item}</For>
        </div>
      </div>

      <div class="eden-sidebar-divider" />

      <div class="eden-sidebar-section eden-sidebar-section-scrollable">
        <div class="eden-sidebar-section-title">
          {t("settings.sidebar.applications")}
        </div>
        <div class="eden-sidebar-items eden-sidebar-items-scrollable">
          <Show
            when={applicationPanels().length > 0}
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
            <For each={applicationPanels()}>{item}</For>
          </Show>
        </div>
      </div>
    </aside>
  );
};

export default SettingsSidebar;

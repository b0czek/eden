import {
  Sidebar,
  SidebarDivider,
  SidebarItem,
  SidebarSection,
} from "@edenapp/solid-kit/sidebar";
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
    props
      .panels()
      .filter((panel) => !panel.parentId && panel.source !== "application");
  const applicationPanels = () =>
    props
      .panels()
      .filter((panel) => !panel.parentId && panel.source === "application");

  const selectedRootId = () => {
    const byId = new Map(props.panels().map((panel) => [panel.id, panel]));
    let current = props.selectedPanelId();
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      seen.add(current);
      const panel = byId.get(current);
      if (!panel?.parentId) return current;
      current = panel.parentId;
    }
    return null;
  };

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

  const panelTitle = (panel: SettingsPanelSummary) =>
    getLocalizedValue(panel.title, locale());

  const item = (panel: SettingsPanelSummary) => (
    <SidebarItem
      label={panelTitle(panel)}
      icon={icon(panel)}
      selected={selectedRootId() === panel.id}
      aria-current={selectedRootId() === panel.id ? "page" : undefined}
      onClick={() => props.onSelect(panel.id)}
    />
  );

  return (
    <Sidebar
      label={t("settings.sidebar.navigation")}
      heading={props.brandName()}
      toggleLabels={{
        collapse: t("settings.sidebar.collapse"),
        expand: t("settings.sidebar.expand"),
      }}
    >
      <SidebarSection>
        <For each={systemPanels()}>{item}</For>
      </SidebarSection>
      <SidebarDivider />
      <SidebarSection title={t("settings.sidebar.applications")}>
        <Show
          when={applicationPanels().length > 0}
          fallback={
            <SidebarItem
              disabled
              icon={<FiPackage />}
              label={t("settings.sidebar.noAppsWithSettings")}
            />
          }
        >
          <For each={applicationPanels()}>{item}</For>
        </Show>
      </SidebarSection>
    </Sidebar>
  );
};

export default SettingsSidebar;

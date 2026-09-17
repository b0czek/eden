import type {
  SettingsPanelAppearanceSnapshot,
  SettingsPanelValue,
  WallpaperConfig,
  WallpaperPreset,
} from "@edenapp/types";
import type { Accessor, Component } from "solid-js";
import { For } from "solid-js";
import { t } from "../i18n";
import type { PanelAction } from "../types";
import "./AppearanceTab.css";

interface AppearancePanelData {
  presets: {
    solid: WallpaperPreset[];
    gradients: WallpaperPreset[];
  };
  wallpaper: WallpaperPreset;
}

const WallpaperGrid: Component<{
  options: WallpaperPreset[];
  onSelect: (preset: WallpaperPreset) => void;
  activeId?: string;
  disabled: boolean;
}> = (props) => (
  <div class="wallpaper-grid">
    <For each={props.options}>
      {(option) => (
        <button
          type="button"
          disabled={props.disabled}
          class={`wallpaper-item ${
            props.activeId === option.id
              ? "wallpaper-item-active"
              : "wallpaper-item-inactive"
          }`}
          style={{ background: option.value }}
          onClick={() => props.onSelect(option)}
        >
          {option.name}
        </button>
      )}
    </For>
  </div>
);

const AppearanceTab: Component<{
  panel: SettingsPanelAppearanceSnapshot;
  busyActions: Accessor<Set<string>>;
  onAction: PanelAction;
}> = (props) => {
  const data = () => props.panel.data as unknown as AppearancePanelData;
  const handleSelect = (preset: WallpaperPreset) => {
    const wallpaper: WallpaperConfig = { type: "preset", id: preset.id };
    void props.onAction("appearance/set-wallpaper", "set-wallpaper", {
      value: {
        wallpaper,
      } as unknown as SettingsPanelValue,
    });
  };

  return (
    <div class="settings-list">
      <div class="settings-section">
        <h2 class="settings-section-title">
          {t("settings.appearance.wallpaper")}
        </h2>
        <h3 class="category-header">{t("settings.appearance.solidColors")}</h3>
        <WallpaperGrid
          options={data().presets.solid}
          onSelect={handleSelect}
          activeId={data().wallpaper.id}
          disabled={props.busyActions().has("appearance/set-wallpaper")}
        />
        <h3 class="category-header">{t("settings.appearance.gradients")}</h3>
        <WallpaperGrid
          options={data().presets.gradients}
          onSelect={handleSelect}
          activeId={data().wallpaper.id}
          disabled={props.busyActions().has("appearance/set-wallpaper")}
        />
      </div>
    </div>
  );
};

export default AppearanceTab;

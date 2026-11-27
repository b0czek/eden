import type {
  EdenTheme,
  SettingsPanelAppearanceSnapshot,
  SettingsPanelValue,
  WallpaperConfig,
  WallpaperPreset,
} from "@edenapp/types";
import type { Accessor, Component } from "solid-js";
import { For } from "solid-js";
import { getLocalizedValue, locale, t } from "../i18n";
import type { PanelAction } from "../types";
import "./AppearanceTab.css";

interface AppearancePanelData {
  presets: {
    solid: WallpaperPreset[];
    gradients: WallpaperPreset[];
  };
  wallpaper: WallpaperPreset;
  theme: string;
  themes: EdenTheme[];
}

/** The panel sends each theme with all of its colors resolved. */
const themeColor = (theme: EdenTheme, token: keyof EdenTheme["colors"]) =>
  theme.colors[token];

// Busy buttons use aria-disabled, which keeps keyboard focus on them.
const ThemeGrid: Component<{
  themes: EdenTheme[];
  activeId: string;
  disabled: boolean;
  labelledBy: string;
  onSelect: (theme: EdenTheme) => void;
}> = (props) => (
  <fieldset class="theme-grid" aria-labelledby={props.labelledBy}>
    <For each={props.themes}>
      {(theme) => (
        <button
          type="button"
          aria-disabled={props.disabled}
          aria-pressed={props.activeId === theme.id}
          class={`theme-item ${
            props.activeId === theme.id
              ? "wallpaper-item-active"
              : "wallpaper-item-inactive"
          }`}
          style={{
            background: themeColor(theme, "bg-primary"),
            color: themeColor(theme, "text-primary"),
          }}
          onClick={() => {
            if (!props.disabled) props.onSelect(theme);
          }}
        >
          <span class="theme-swatches" aria-hidden="true">
            <span
              style={{ background: themeColor(theme, "surface-primary") }}
            />
            <span style={{ background: themeColor(theme, "accent-primary") }} />
            <span style={{ background: themeColor(theme, "success") }} />
          </span>
          <span class="theme-name">
            {getLocalizedValue(theme.name, locale())}
          </span>
          <span class="theme-scheme">
            {t(`settings.appearance.${theme.colorScheme}`)}
          </span>
        </button>
      )}
    </For>
  </fieldset>
);

const WallpaperGrid: Component<{
  options: WallpaperPreset[];
  onSelect: (preset: WallpaperPreset) => void;
  activeId?: string;
  disabled: boolean;
  labelledBy: string;
}> = (props) => (
  <fieldset class="wallpaper-grid" aria-labelledby={props.labelledBy}>
    <For each={props.options}>
      {(option) => (
        <button
          type="button"
          aria-disabled={props.disabled}
          aria-pressed={props.activeId === option.id}
          class={`wallpaper-item ${
            props.activeId === option.id
              ? "wallpaper-item-active"
              : "wallpaper-item-inactive"
          }`}
          style={{ background: option.value }}
          onClick={() => {
            if (!props.disabled) props.onSelect(option);
          }}
        >
          {option.name}
        </button>
      )}
    </For>
  </fieldset>
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

  const busy = (action: string) => props.busyActions().has(action);
  const setTheme = (theme: EdenTheme) => {
    if (theme.id === data().theme) return;
    void props.onAction("appearance/set-theme", "set-theme", {
      value: theme.id,
    });
  };

  return (
    <div class="settings-list">
      <div class="settings-section">
        <h2 id="appearance-theme" class="settings-section-title">
          {t("settings.appearance.theme")}
        </h2>
        <ThemeGrid
          themes={data().themes}
          activeId={data().theme}
          disabled={busy("appearance/set-theme")}
          labelledBy="appearance-theme"
          onSelect={setTheme}
        />
      </div>
      <div class="settings-section">
        <h2 class="settings-section-title">
          {t("settings.appearance.wallpaper")}
        </h2>
        <h3 id="appearance-solid" class="category-header">
          {t("settings.appearance.solidColors")}
        </h3>
        <WallpaperGrid
          options={data().presets.solid}
          onSelect={handleSelect}
          activeId={data().wallpaper.id}
          disabled={busy("appearance/set-wallpaper")}
          labelledBy="appearance-solid"
        />
        <h3 id="appearance-gradients" class="category-header">
          {t("settings.appearance.gradients")}
        </h3>
        <WallpaperGrid
          options={data().presets.gradients}
          onSelect={handleSelect}
          activeId={data().wallpaper.id}
          disabled={busy("appearance/set-wallpaper")}
          labelledBy="appearance-gradients"
        />
      </div>
    </div>
  );
};

export default AppearanceTab;

import { Component, For, createSignal, onMount } from "solid-js";
import type { WallpaperPreset, WallpaperConfig } from "@edenapp/types";
import { t } from "../i18n";
import "./AppearanceTab.css";

const WallpaperGrid: Component<{
  options: WallpaperPreset[];
  onSelect: (preset: WallpaperPreset) => void;
  activeId?: string;
}> = (props) => (
  <div class="wallpaper-grid">
    <For each={props.options}>
      {(option) => (
        <div
          class={`wallpaper-item ${
            props.activeId === option.id
              ? "wallpaper-item-active"
              : "wallpaper-item-inactive"
          }`}
          style={{
            background: option.value,
          }}
          onClick={() => props.onSelect(option)}
        >
          {option.name}
        </div>
      )}
    </For>
  </div>
);

const AppearanceTab: Component = () => {
  const [solidPresets, setSolidPresets] = createSignal<WallpaperPreset[]>([]);
  const [gradientPresets, setGradientPresets] = createSignal<WallpaperPreset[]>(
    [],
  );
  const [activeId, setActiveId] = createSignal<string | undefined>(undefined);

  onMount(async () => {
    try {
      // Load presets
      const presetsResult = await window.edenAPI.shellCommand(
        "appearance/get-presets",
        {},
      );
      if (presetsResult) {
        setSolidPresets(presetsResult.solid || []);
        setGradientPresets(presetsResult.gradients || []);
      }

      // Load current wallpaper to highlight
      const currentResult = await window.edenAPI.shellCommand(
        "appearance/get-wallpaper",
        {},
      );
      if (currentResult && currentResult.wallpaper) {
        // appearance/get-wallpaper returns a WallpaperPreset object, so we use its ID
        setActiveId(currentResult.wallpaper.id);
      }
    } catch (err) {
      console.error("Failed to load appearance data:", err);
    }
  });

  const handleSelect = async (preset: WallpaperPreset) => {
    // Optimistic UI update
    setActiveId(preset.id);

    const config: WallpaperConfig = { type: "preset", id: preset.id };
    try {
      // Send DTO directly to backend
      await window.edenAPI.shellCommand("appearance/set-wallpaper", {
        wallpaper: config,
      });
    } catch (err) {
      console.error("Failed to set wallpaper:", err);
    }
  };

  return (
    <div class="settings-list">
      <div class="settings-section">
        <h2 class="settings-section-title">
          {t("settings.appearance.wallpaper")}
        </h2>

        <h3 class="category-header">{t("settings.appearance.solidColors")}</h3>
        <WallpaperGrid
          options={solidPresets()}
          onSelect={handleSelect}
          activeId={activeId()}
        />

        <h3 class="category-header">{t("settings.appearance.gradients")}</h3>
        <WallpaperGrid
          options={gradientPresets()}
          onSelect={handleSelect}
          activeId={activeId()}
        />
      </div>
    </div>
  );
};

export default AppearanceTab;

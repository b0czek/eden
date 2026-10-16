import type { WallpaperConfig, WallpaperPreset } from "@edenapp/types";

export const WALLPAPER_PRESETS: WallpaperPreset[] = [
  // Solid Colors
  { id: "midnight", name: "Midnight", type: "color", value: "#1a1b26" },
  { id: "deep-space", name: "Deep Space", type: "color", value: "#1e1e2e" },
  { id: "charcoal", name: "Charcoal", type: "color", value: "#282c34" },
  { id: "pure-black", name: "Pure Black", type: "color", value: "#000000" },
  { id: "slate", name: "Slate", type: "color", value: "#64748b" },
  // Gradients
  {
    id: "eden-default",
    name: "Eden Default",
    type: "gradient",
    value: "linear-gradient(135deg, #1e1e2e 0%, #1a1b26 100%)",
  },
  {
    id: "aurora",
    name: "Aurora",
    type: "gradient",
    value: "linear-gradient(to right, #43cea2, #185a9d)",
  },
  {
    id: "nordic",
    name: "Nordic",
    type: "gradient",
    value: "linear-gradient(to right, #0F2027, #203A43, #2C5364)",
  },
  {
    id: "nebula",
    name: "Nebula",
    type: "gradient",
    value: "linear-gradient(to right, #000428, #004e92)",
  },
  {
    id: "deep-sea",
    name: "Deep Sea",
    type: "gradient",
    value: "linear-gradient(to top, #2b32b2, #1488cc)",
  },
  {
    id: "volcanic",
    name: "Volcanic",
    type: "gradient",
    value: "linear-gradient(to right, #232526, #414345)",
  },
];

function getDefaultWallpaperPreset(): WallpaperPreset {
  const preset = WALLPAPER_PRESETS.find((p) => p.id === "eden-default");
  if (!preset) {
    throw new Error("Default wallpaper preset not found");
  }
  return preset;
}

export const DEFAULT_WALLPAPER_PRESET = getDefaultWallpaperPreset();

export function resolveWallpaper(config: WallpaperConfig): WallpaperPreset {
  if (config.type === "preset") {
    const preset = WALLPAPER_PRESETS.find((p) => p.id === config.id);
    return preset ? preset : DEFAULT_WALLPAPER_PRESET;
  } else if (config.type === "custom") {
    return {
      id: "custom",
      name: "Custom",
      type: "custom",
      value: config.value,
    };
  }
  return DEFAULT_WALLPAPER_PRESET;
}

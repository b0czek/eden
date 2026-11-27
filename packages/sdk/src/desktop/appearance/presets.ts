import type {
  ColorScheme,
  WallpaperConfig,
  WallpaperPreset,
} from "@edenapp/types";

interface WallpaperVariant {
  name: string;
  value: string;
}

/** A preset keeps its ID across schemes and shows a variant for each one. */
interface WallpaperPresetDefinition {
  id: string;
  type: "color" | "gradient";
  variants: Record<ColorScheme, WallpaperVariant>;
}

function sameName(name: string, light: string, dark: string) {
  return { light: { name, value: light }, dark: { name, value: dark } };
}

const WALLPAPER_PRESETS: WallpaperPresetDefinition[] = [
  // Solid Colors
  {
    id: "midnight",
    type: "color",
    variants: sameName("Midnight", "#dfe3f0", "#1a1b26"),
  },
  {
    id: "deep-space",
    type: "color",
    variants: sameName("Deep Space", "#e6e6f2", "#1e1e2e"),
  },
  {
    id: "charcoal",
    type: "color",
    variants: sameName("Charcoal", "#d9dce2", "#282c34"),
  },
  {
    id: "pure-black",
    type: "color",
    variants: {
      light: { name: "Pure White", value: "#ffffff" },
      dark: { name: "Pure Black", value: "#000000" },
    },
  },
  {
    id: "slate",
    type: "color",
    variants: sameName("Slate", "#94a3b8", "#64748b"),
  },
  // Gradients
  {
    id: "eden-default",
    type: "gradient",
    variants: sameName(
      "Eden Default",
      "linear-gradient(135deg, #f4f5fb 0%, #e3e6f3 100%)",
      "linear-gradient(135deg, #1e1e2e 0%, #1a1b26 100%)",
    ),
  },
  {
    id: "aurora",
    type: "gradient",
    variants: sameName(
      "Aurora",
      "linear-gradient(to right, #b4f0d9, #a6c8ea)",
      "linear-gradient(to right, #43cea2, #185a9d)",
    ),
  },
  {
    id: "nordic",
    type: "gradient",
    variants: sameName(
      "Nordic",
      "linear-gradient(to right, #e3ecf0, #cfdee5, #bccfd9)",
      "linear-gradient(to right, #0F2027, #203A43, #2C5364)",
    ),
  },
  {
    id: "nebula",
    type: "gradient",
    variants: sameName(
      "Nebula",
      "linear-gradient(to right, #d4dcff, #b8d4f0)",
      "linear-gradient(to right, #000428, #004e92)",
    ),
  },
  {
    id: "deep-sea",
    type: "gradient",
    variants: sameName(
      "Deep Sea",
      "linear-gradient(to top, #a1c4fd, #c2e9fb)",
      "linear-gradient(to top, #2b32b2, #1488cc)",
    ),
  },
  {
    id: "volcanic",
    type: "gradient",
    variants: sameName(
      "Volcanic",
      "linear-gradient(to right, #e6e6e6, #c4c8cc)",
      "linear-gradient(to right, #232526, #414345)",
    ),
  },
];

export const DEFAULT_WALLPAPER_ID = "eden-default";

function presetFor(
  definition: WallpaperPresetDefinition,
  colorScheme: ColorScheme,
): WallpaperPreset {
  const { name, value } = definition.variants[colorScheme];
  return { id: definition.id, name, type: definition.type, value };
}

function findPreset(id: string) {
  return WALLPAPER_PRESETS.find((preset) => preset.id === id);
}

export function defaultWallpaper(colorScheme: ColorScheme): WallpaperPreset {
  const preset = findPreset(DEFAULT_WALLPAPER_ID);
  if (!preset) throw new Error("Default wallpaper preset not found");
  return presetFor(preset, colorScheme);
}

export function wallpaperPresets(colorScheme: ColorScheme) {
  return {
    solid: WALLPAPER_PRESETS.filter((preset) => preset.type === "color").map(
      (preset) => presetFor(preset, colorScheme),
    ),
    gradients: WALLPAPER_PRESETS.filter(
      (preset) => preset.type === "gradient",
    ).map((preset) => presetFor(preset, colorScheme)),
  };
}

/** Custom wallpapers look the same in both schemes. */
export function resolveWallpaper(
  config: WallpaperConfig,
  colorScheme: ColorScheme,
): WallpaperPreset {
  if (config.type === "custom") {
    return {
      id: "custom",
      name: "Custom",
      type: "custom",
      value: config.value,
    };
  }
  const preset = findPreset(config.id);
  return preset
    ? presetFor(preset, colorScheme)
    : defaultWallpaper(colorScheme);
}

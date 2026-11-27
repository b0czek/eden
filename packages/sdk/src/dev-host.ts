import { createEden } from "./host";

const dataDirectory = process.env.EDEN_DEV_DATA_DIRECTORY ?? ".eden-dev";
const stateDirectory =
  process.env.EDEN_DEV_HOT_RELOAD_DIRECTORY ?? ".eden-hot-reload";
const seedPath = process.env.EDEN_DEV_SEED_PATH;

createEden({
  development: true,
  tiling: {
    mode: "smart",
    gap: 8,
    padding: 8,
    minTileWidth: 600,
    minTileHeight: 400,
  },
  dataDirectory,
  seedPath,
  window: {
    title: "Eden SDK Dev Host",
  },
  hotReload: {
    enabled: true,
    stateDirectory,
  },
  appearance: {
    themes: [
      {
        id: "dev-pink",
        name: "Pink",
        colorScheme: "light",
        colors: {
          "bg-primary": "#faf5f7",
          "bg-secondary": "#ffeef5",
          "bg-glass-strong": "rgba(255, 240, 245, 0.8)",
          "surface-secondary": "#faf5f7",
          "surface-tertiary": "#f5eef1",
          "surface-hover": "rgba(255, 240, 245, 0.5)",
          "surface-active": "rgba(255, 182, 193, 0.3)",
          "accent-primary": "#ff69b4",
          "accent-primary-hover": "#ff85c1",
          "accent-primary-active": "#ff1493",
          "accent-blue": "rgb(255, 105, 180)",
          "accent-blue-dark": "rgb(255, 20, 147)",
          "accent-purple": "#ff6b9d",
          "accent-purple-light": "#ffb3d9",
          info: "#ff91a4",
          "border-light": "rgba(255, 182, 193, 0.2)",
          "border-medium": "rgba(255, 182, 193, 0.3)",
          "border-separator": "rgba(255, 182, 193, 0.25)",
        },
      },
    ],
  },
  coreApps: ["com.eden.eveshell", "com.eden.toaster", "com.eden.context-menu"],
  restrictedApps: ["com.eden.login", "com.eden.users"],
});

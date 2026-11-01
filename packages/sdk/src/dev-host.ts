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
  coreApps: ["com.eden.eveshell", "com.eden.toaster", "com.eden.context-menu"],
  restrictedApps: ["com.eden.login", "com.eden.users"],
});

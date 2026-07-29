import { Eden } from "./Eden";

const appsDirectory = process.env.EDEN_DEV_APPS_DIRECTORY ?? ".eden-dev/apps";
const userDirectory = process.env.EDEN_DEV_USER_DIRECTORY ?? ".eden-dev/user";
const stateDirectory =
  process.env.EDEN_DEV_HOT_RELOAD_DIRECTORY ?? ".eden-hot-reload";
const seedPath = process.env.EDEN_DEV_SEED_PATH;

new Eden({
  development: true,
  tiling: {
    mode: "smart",
    gap: 8,
    padding: 8,
    minTileWidth: 600,
    minTileHeight: 400,
  },
  userDirectory,
  appsDirectory,
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

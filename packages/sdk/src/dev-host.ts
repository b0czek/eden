import { Eden } from "./Eden";

new Eden({
  development: true,
  tiling: {
    mode: "smart",
    gap: 8,
    padding: 8,
    minTileWidth: 600,
    minTileHeight: 400,
  },
  userDirectory: ".eden-dev/user",
  appsDirectory: ".eden-dev/apps",
  window: {
    title: "Eden SDK Dev Host",
  },
  hotReload: {
    enabled: true,
    stateDirectory: ".eden-hot-reload",
  },
  coreApps: ["com.eden.eveshell", "com.eden.toaster", "com.eden.context-menu"],
  restrictedApps: ["com.eden.login", "com.eden.users"],
});

import { Eden } from "@edenapp/sdk";

// Create and start the Eden desktop environment
new Eden({
  development: process.env.NODE_ENV === "development",
  tiling: {
    mode: "smart", // Options: "none", "horizontal", "vertical", "grid", "smart"
    gap: 8, // Gap between tiles in pixels
    padding: 8, // Padding around workspace in pixels
    minTileWidth: 600,
    minTileHeight: 400,
  },
  userDirectory: ".",
  window: {
    title: "Eden SDK Example",
  },
  coreApps: ["com.eden.eveshell", "com.eden.toaster", "com.eden.context-menu"],
  restrictedApps: ["com.eden.login", "com.eden.users"],
});

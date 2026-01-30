import { Eden } from "@edenapp/sdk";

// Create and start the Eden desktop environment
new Eden({
  development: process.env.NODE_ENV === "development",
  tiling: {
    mode: "horizontal", // Options: "none", "horizontal", "vertical", "grid"
    gap: 8, // Gap between tiles in pixels
    padding: 8, // Padding around workspace in pixels
  },
  userDirectory: ".",
  window: {
    title: "Eden SDK Example",
  },
  coreApps: ["com.eden.eveshell", "com.eden.toaster"],
  restrictedApps: ["com.eden.login", "com.eden.users"],
});

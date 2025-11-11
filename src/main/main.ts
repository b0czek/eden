import { Eden } from "./Eden";

// Create and start the Eden app
new Eden({
  development: process.env.NODE_ENV === "development",
  tiling: {
    mode: "horizontal", // Options: "none", "horizontal", "vertical", "grid"
    gap: 8, // Gap between tiles in pixels
    padding: 8, // Padding around workspace in pixels
  },
});

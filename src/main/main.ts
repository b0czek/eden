import { Eden } from "./Eden";

// Create and start the Eden app
new Eden({
  development: process.env.NODE_ENV === "development",
});

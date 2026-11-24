import solidPlugin from "vite-plugin-solid";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [solidPlugin()],
  optimizeDeps: {
    exclude: ["solid-icons"],
  },
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    environment: "jsdom",
    clearMocks: true,
  },
});

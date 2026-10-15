import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import solidPlugin from "vite-plugin-solid";
import { configDefaults, defineConfig } from "vitest/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [solidPlugin()],
  base: "./",
  root: __dirname,
  build: {
    outDir: "./dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "index.html"),
    },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
  test: {
    environment: "node",
    exclude: [...configDefaults.exclude, "**/*.electron.spec.ts"],
  },
});

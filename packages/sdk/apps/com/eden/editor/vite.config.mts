import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

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
});

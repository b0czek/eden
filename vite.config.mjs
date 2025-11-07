import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [solidPlugin()],
  base: "./",
  root: "src/eveshell",
  build: {
    outDir: "../../dist/eveshell",
    emptyOutDir: false,
    rollupOptions: {
      input: resolve(__dirname, "src/eveshell/index.html"),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]'
      }
    },
  },
  resolve: {
    conditions: ["development", "browser"],
  },
});

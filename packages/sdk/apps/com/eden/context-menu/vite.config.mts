import { defineConfig } from "vite";
import * as path from "path";

export default defineConfig({
  root: __dirname,
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, "index.html"),
    },
  },
  server: {
    port: 5210,
    strictPort: true,
  },
});

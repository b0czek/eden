import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { monaco } from "@bithero/monaco-editor-vite-plugin";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [
    solidPlugin(),
    // Configure Monaco for syntax highlighting only (no language servers)
    // Syntax highlighting still works via Monarch tokenizers
    monaco({
      // Only include features we need for a text editor (not an IDE)
      features: [
        "bracketMatching",
        "clipboard",
        "find",
        "folding",
        "fontZoom",
        "indentation",
        "lineSelection",
        "links",
        "multicursor",
        "wordHighlighter",
        "wordOperations",
        "wordPartOperations",
      ],
      // Don't use built-in languages (they include heavy language service workers)
      languages: [],
      // Use customLanguages to include ONLY the basic syntax highlighting
      // without the language service workers (IntelliSense, error checking, etc.)
      customLanguages: [
        // TypeScript/JavaScript - only basic syntax highlighting, no tsserver
        { label: "typescript", entry: "vs/basic-languages/typescript/typescript.contribution" },
        { label: "javascript", entry: "vs/basic-languages/javascript/javascript.contribution" },
        // Web languages - only syntax highlighting, no workers
        { label: "html", entry: "vs/basic-languages/html/html.contribution" },
        { label: "css", entry: "vs/basic-languages/css/css.contribution" },
        { label: "less", entry: "vs/basic-languages/less/less.contribution" },
        // Data formats
        { label: "json", entry: "vs/language/json/monaco.contribution" }, // JSON doesn't have basic-languages, use the lightweight contribution
        { label: "yaml", entry: "vs/basic-languages/yaml/yaml.contribution" },
        // Config files
        { label: "ini", entry: "vs/basic-languages/ini/ini.contribution" },
        { label: "shell", entry: "vs/basic-languages/shell/shell.contribution" },
        // Markdown
        { label: "markdown", entry: "vs/basic-languages/markdown/markdown.contribution" },
      ],
      globalAPI: false,
    }),
  ],
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

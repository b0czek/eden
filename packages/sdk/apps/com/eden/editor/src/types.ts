// Tab interface for managing multiple open files
export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isModified: boolean;
  language: string;
}

// File opened event type
export interface FileOpenedEvent {
  path: string;
  isDirectory: boolean;
  appId: string;
}

// Extension to Monaco language mapping
export const extensionToLanguage: Record<string, string> = {
  // Text
  txt: "plaintext",
  md: "markdown",
  markdown: "markdown",
  log: "plaintext",

  // JavaScript/TypeScript
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",

  // Web
  html: "html",
  htm: "html",
  css: "css",
  less: "less",

  // Data
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",

  // Config
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  env: "shell",

  // Shell scripts
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
};

export function getLanguageFromPath(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  return extensionToLanguage[ext] || "plaintext";
}

export function getFileName(filePath: string): string {
  return filePath.split("/").pop() || "Untitled";
}

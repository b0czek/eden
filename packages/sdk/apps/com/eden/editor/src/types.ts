import type { EditorState, StateEffect } from "@codemirror/state";
import type { EditorLanguageName } from "@edenapp/editor-dlc";

export interface EditorTab {
  id: string;
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isModified: boolean;
  language: string;
  languageName: EditorLanguageName;
  state: EditorState;
  scrollSnapshot?: StateEffect<unknown>;
}

// File opened event type
export interface FileOpenedEvent {
  path: string;
  isDirectory: boolean;
  appId: string;
}

export const extensionToLanguage: Record<string, string> = {
  // Text
  txt: "plaintext",
  md: "markdown",
  markdown: "markdown",
  log: "plaintext",

  // JavaScript/TypeScript
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
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
  toml: "toml",

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
  return Object.hasOwn(extensionToLanguage, ext)
    ? extensionToLanguage[ext]
    : "plaintext";
}

export function getFileName(filePath: string): string {
  return filePath.split("/").pop() || "Untitled";
}

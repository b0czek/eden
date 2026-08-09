import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { yaml } from "@codemirror/lang-yaml";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { getLanguageFromPath } from "./types";

const languageExtensions: Record<string, () => Extension> = {
  plaintext: () => [],
  markdown,
  javascript: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  html,
  css,
  less: css,
  json,
  yaml,
  toml: () => StreamLanguage.define(toml),
  ini: () => StreamLanguage.define(properties),
  shell: () => StreamLanguage.define(shell),
};

const codeHighlightStyle = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.operatorKeyword],
    color: "var(--eden-color-accent-purple-light)",
  },
  {
    tag: [tags.string, tags.regexp, tags.special(tags.string)],
    color: "var(--eden-color-success)",
  },
  {
    tag: [tags.number, tags.bool, tags.null],
    color: "var(--eden-color-warning)",
  },
  {
    tag: [tags.comment, tags.meta],
    color: "var(--eden-color-text-muted)",
    fontStyle: "italic",
  },
  {
    tag: [tags.function(tags.variableName), tags.labelName],
    color: "var(--eden-color-info)",
  },
  {
    tag: [tags.typeName, tags.className, tags.namespace],
    color: "var(--eden-color-accent-blue)",
  },
  {
    tag: [tags.heading, tags.strong],
    color: "var(--eden-color-text-primary)",
    fontWeight: "600",
  },
  {
    tag: tags.link,
    color: "var(--eden-color-accent-primary)",
    textDecoration: "underline",
  },
  { tag: tags.invalid, color: "var(--eden-color-danger)" },
]);

const edenTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--eden-color-text-primary)",
    backgroundColor: "var(--eden-color-bg-primary)",
    fontSize: "var(--eden-font-size-base)",
  },
  ".cm-scroller": {
    fontFamily: "var(--eden-font-family-mono)",
    lineHeight: "var(--eden-font-line-height-normal)",
    overflow: "auto",
  },
  ".cm-content": {
    minHeight: "100%",
    padding: "var(--eden-space-sm) 0",
  },
  ".cm-line": { padding: "0 var(--eden-space-sm)" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--eden-color-text-primary)",
  },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection":
    {
      backgroundColor:
        "color-mix(in srgb, var(--eden-color-accent-primary) 35%, transparent)",
    },
  ".cm-activeLine": {
    backgroundColor: "var(--eden-color-bg-glass-light)",
  },
  ".cm-gutters": {
    color: "var(--eden-color-text-muted)",
    backgroundColor: "var(--eden-color-bg-secondary)",
    borderRight: "1px solid var(--eden-color-border-light)",
  },
  ".cm-activeLineGutter": {
    color: "var(--eden-color-text-primary)",
    backgroundColor: "var(--eden-color-surface-hover)",
  },
  ".cm-foldPlaceholder": {
    color: "var(--eden-color-text-secondary)",
    backgroundColor: "var(--eden-color-surface-secondary)",
    borderColor: "var(--eden-color-border-medium)",
  },
  ".cm-panels": {
    color: "var(--eden-color-text-primary)",
    backgroundColor: "var(--eden-color-bg-secondary)",
  },
  ".cm-panels.cm-panels-top": {
    borderBottom: "1px solid var(--eden-color-border-medium)",
  },
  ".cm-panels.cm-panels-bottom": {
    borderTop: "1px solid var(--eden-color-border-medium)",
  },
  ".cm-searchMatch": {
    backgroundColor:
      "color-mix(in srgb, var(--eden-color-warning) 35%, transparent)",
  },
  ".cm-searchMatch.cm-searchMatch-selected": {
    backgroundColor:
      "color-mix(in srgb, var(--eden-color-accent-primary) 45%, transparent)",
  },
  ".cm-panel input": {
    color: "var(--eden-color-text-primary)",
    backgroundColor: "var(--eden-color-surface-primary)",
    border: "1px solid var(--eden-color-border-medium)",
    borderRadius: "var(--eden-radius-xs)",
  },
  ".cm-panel button": {
    color: "var(--eden-color-text-primary)",
    backgroundColor: "var(--eden-color-surface-tertiary)",
    border: "1px solid var(--eden-color-border-medium)",
    borderRadius: "var(--eden-radius-xs)",
  },
});

export function languageExtensionForPath(filePath: string): Extension {
  return languageExtensions[getLanguageFromPath(filePath)]?.() ?? [];
}

export function editorExtensions(filePath: string): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    syntaxHighlighting(codeHighlightStyle),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    indentUnit.of("  "),
    EditorState.tabSize.of(2),
    keymap.of([
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    edenTheme,
    languageExtensionForPath(filePath),
  ];
}

export function createEditorState(
  filePath: string,
  content: string,
): EditorState {
  return EditorState.create({
    doc: content,
    extensions: editorExtensions(filePath),
  });
}

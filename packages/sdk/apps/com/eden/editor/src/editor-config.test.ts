import { redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import type { Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createEditorState, languageExtensionForPath } from "./editor-config";
import { getLanguageFromPath } from "./types";

describe("editor language resolution", () => {
  it.each([
    ["notes.txt", "plaintext"],
    ["README.md", "markdown"],
    ["app.js", "javascript"],
    ["component.jsx", "jsx"],
    ["types.ts", "typescript"],
    ["view.tsx", "tsx"],
    ["index.html", "html"],
    ["styles.css", "css"],
    ["theme.less", "less"],
    ["data.json", "json"],
    ["config.yaml", "yaml"],
    ["settings.toml", "toml"],
    ["app.ini", "ini"],
    ["script.sh", "shell"],
  ])("maps %s to %s", (path, expected) => {
    expect(getLanguageFromPath(path)).toBe(expected);
    expect(() => languageExtensionForPath(path)).not.toThrow();
  });

  it("falls back to plain text for unknown and extensionless files", () => {
    expect(getLanguageFromPath("archive.unknown")).toBe("plaintext");
    expect(getLanguageFromPath("README")).toBe("plaintext");
    expect(languageExtensionForPath("archive.unknown")).toEqual([]);
  });
});

describe("editor state configuration", () => {
  it("uses two-space indentation and a two-column tab size", () => {
    const state = createEditorState("example.ts", "const value = 1;");

    expect(state.facet(indentUnit)).toBe("  ");
    expect(state.tabSize).toBe(2);
  });

  it("keeps documents, selections, and undo history independent", () => {
    const first = createEditorState("first.ts", "one");
    const second = createEditorState("second.ts", "two");
    const editedFirst = first.update({
      changes: { from: 3, insert: "!" },
      selection: { anchor: 4 },
    }).state;

    expect(editedFirst.doc.toString()).toBe("one!");
    expect(editedFirst.selection.main.head).toBe(4);
    expect(undoDepth(editedFirst)).toBe(1);
    expect(second.doc.toString()).toBe("two");
    expect(second.selection.main.head).toBe(0);
    expect(undoDepth(second)).toBe(0);
  });

  it("applies undo and redo through state commands", () => {
    let state = createEditorState("example.ts", "one").update({
      changes: { from: 3, insert: "!" },
    }).state;
    const target = () => ({
      state,
      dispatch: (transaction: Transaction) => {
        state = transaction.state;
      },
    });

    expect(undo(target())).toBe(true);
    expect(state.doc.toString()).toBe("one");
    expect(redoDepth(state)).toBe(1);
    expect(redo(target())).toBe(true);
    expect(state.doc.toString()).toBe("one!");
  });
});

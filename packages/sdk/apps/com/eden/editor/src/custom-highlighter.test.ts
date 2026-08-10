import type { EditorLineHighlighter } from "@edenapp/editor-dlc";
import { describe, expect, it } from "vitest";
import { buildHighlightDecorations } from "./custom-highlighter";
import { createEditorState } from "./editor-config";

describe("DLC line highlighting", () => {
  it("turns valid line-relative spans into CodeMirror decorations", () => {
    const contexts: Array<{
      path: string;
      languageId: string;
      lineNumber: number;
    }> = [];
    const errors: unknown[] = [];
    const highlighter: EditorLineHighlighter = {
      tokenStyles: {
        comment: "comment",
        number: "number",
        ignored: "plain",
      },
      highlightLine(text, context) {
        contexts.push(context);
        if (text === "BOOM") throw new Error("bad line");
        const spans = [];
        const number = text.match(/\d+/);
        if (number?.index !== undefined) {
          spans.push({
            from: number.index,
            to: number.index + number[0].length,
            kind: "number",
          });
        }
        const comment = text.indexOf(";");
        if (comment >= 0) {
          spans.push({ from: comment, to: text.length, kind: "comment" });
        }
        spans.push({ from: 0, to: 1, kind: "ignored" });
        spans.push({ from: -1, to: 200, kind: "number" });
        spans.push({ from: 0, to: 1, kind: "unknown" });
        spans.push({ from: 0, to: 1, kind: "__proto__" });
        return spans;
      },
    };
    const language = { id: "demo", name: "Demo", highlighter };
    const state = createEditorState(
      "program.demo",
      "A12 ;note\nBOOM\nA3",
      language,
    );

    const decorations = buildHighlightDecorations(
      state,
      [{ from: 0, to: state.doc.length }],
      "program.demo",
      "demo",
      highlighter,
      (error) => errors.push(error),
    );
    const positions: Array<[number, number]> = [];
    decorations.between(0, state.doc.length, (from, to) => {
      positions.push([from, to]);
    });

    expect(positions).toEqual([
      [1, 3],
      [4, 9],
      [16, 17],
    ]);
    expect(contexts).toEqual([
      { path: "program.demo", languageId: "demo", lineNumber: 1 },
      { path: "program.demo", languageId: "demo", lineNumber: 2 },
      { path: "program.demo", languageId: "demo", lineNumber: 3 },
    ]);
    expect(errors).toHaveLength(1);
  });

  it("recomputes decorations against edited document state", () => {
    const highlighter: EditorLineHighlighter = {
      tokenStyles: { value: "number" },
      highlightLine(text) {
        return text.length > 0
          ? [{ from: 0, to: text.length, kind: "value" }]
          : [];
      },
    };
    const initial = createEditorState("part.demo", "1", {
      id: "demo",
      name: "Demo",
      highlighter,
    });
    const edited = initial.update({ changes: { from: 1, insert: "23" } }).state;
    const decorations = buildHighlightDecorations(
      edited,
      [{ from: 0, to: edited.doc.length }],
      "part.demo",
      "demo",
      highlighter,
    );
    const positions: Array<[number, number]> = [];
    decorations.between(0, edited.doc.length, (from, to) => {
      positions.push([from, to]);
    });

    expect(positions).toEqual([[0, 3]]);
  });
});

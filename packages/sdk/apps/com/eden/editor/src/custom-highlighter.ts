import { highlightingFor } from "@codemirror/language";
import type { EditorState, Extension, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import type {
  EditorHighlightStyle,
  EditorLineHighlighter,
} from "@edenapp/editor-dlc";
import { type Tag, tags } from "@lezer/highlight";

export interface HighlightRange {
  from: number;
  to: number;
}

const styleTags: Record<Exclude<EditorHighlightStyle, "plain">, Tag> = {
  comment: tags.comment,
  keyword: tags.keyword,
  operator: tags.operator,
  number: tags.number,
  string: tags.string,
  variable: tags.variableName,
  property: tags.propertyName,
  type: tags.typeName,
  function: tags.function(tags.variableName),
  label: tags.labelName,
  heading: tags.heading,
  link: tags.link,
  meta: tags.meta,
  invalid: tags.invalid,
};

function decorationClass(
  state: EditorState,
  style: EditorHighlightStyle,
): string | null {
  if (style === "plain") return null;
  return highlightingFor(state, [styleTags[style]]);
}

/** Build decorations for complete lines intersecting the supplied ranges. */
export function buildHighlightDecorations(
  state: EditorState,
  ranges: readonly HighlightRange[],
  path: string,
  languageId: string,
  highlighter: EditorLineHighlighter,
  onError?: (error: unknown) => void,
): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const visitedLines = new Set<number>();

  for (const range of ranges) {
    if (
      range.from < 0 ||
      range.to < range.from ||
      range.to > state.doc.length
    ) {
      continue;
    }

    let line = state.doc.lineAt(range.from);
    while (true) {
      if (!visitedLines.has(line.number)) {
        visitedLines.add(line.number);
        try {
          const spans = highlighter.highlightLine(line.text, {
            path,
            languageId,
            lineNumber: line.number,
          });
          if (!Array.isArray(spans)) {
            throw new TypeError("highlightLine must return an array");
          }

          for (const span of spans) {
            if (
              !span ||
              !Number.isInteger(span.from) ||
              !Number.isInteger(span.to) ||
              span.from < 0 ||
              span.to <= span.from ||
              span.to > line.length ||
              typeof span.kind !== "string"
            ) {
              continue;
            }
            if (!Object.hasOwn(highlighter.tokenStyles, span.kind)) continue;
            const style = highlighter.tokenStyles[span.kind];
            if (
              typeof style !== "string" ||
              (style !== "plain" && !Object.hasOwn(styleTags, style))
            ) {
              continue;
            }
            const className = decorationClass(state, style);
            if (!className) continue;
            decorations.push(
              Decoration.mark({ class: className }).range(
                line.from + span.from,
                line.from + span.to,
              ),
            );
          }
        } catch (error) {
          onError?.(error);
        }
      }

      if (line.to >= range.to || line.to === state.doc.length) break;
      line = state.doc.line(line.number + 1);
    }
  }

  return Decoration.set(decorations, true);
}

export function lineHighlighterExtension(
  path: string,
  languageId: string,
  highlighter: EditorLineHighlighter,
): Extension {
  let reportedError = false;
  const reportError = (error: unknown) => {
    if (reportedError) return;
    reportedError = true;
    console.warn(
      `Language highlighter ${languageId} failed for ${path}`,
      error,
    );
  };

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildHighlightDecorations(
          view.state,
          view.visibleRanges,
          path,
          languageId,
          highlighter,
          reportError,
        );
      }

      update(update: ViewUpdate) {
        if (!update.docChanged && !update.viewportChanged) return;
        this.decorations = buildHighlightDecorations(
          update.state,
          update.view.visibleRanges,
          path,
          languageId,
          highlighter,
          reportError,
        );
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

import type {
  EditorHighlighterModule,
  EditorHighlightSpan,
  EditorHighlightStyle,
} from "@edenapp/editor-dlc";

type FixtureToken = "value";

const tokenStyles = {
  value: "number",
} satisfies Record<FixtureToken, EditorHighlightStyle>;

const highlighter = {
  tokenStyles,
  highlightLine(text: string): EditorHighlightSpan<FixtureToken>[] {
    return text.length > 0 ? [{ from: 0, to: text.length, kind: "value" }] : [];
  },
};

export default {
  highlighters: {
    demo: highlighter,
    alpha: highlighter,
    beta: highlighter,
    "custom-json": highlighter,
  },
} satisfies EditorHighlighterModule;

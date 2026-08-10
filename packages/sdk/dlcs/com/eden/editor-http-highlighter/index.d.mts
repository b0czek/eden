/** Public declarations for the bundled HTTP Client tokenizer. */
import type {
  EditorHighlighterModule,
  EditorHighlightSpan,
} from "@edenapp/editor-dlc";

export type HttpHighlightToken =
  | "comment"
  | "header"
  | "keyword"
  | "method"
  | "number"
  | "operator"
  | "protocol"
  | "script-boundary"
  | "separator"
  | "string"
  | "url"
  | "variable";

export function highlightHttpLine(
  text: string,
): EditorHighlightSpan<HttpHighlightToken>[];

declare const highlighterModule: EditorHighlighterModule;
export default highlighterModule;

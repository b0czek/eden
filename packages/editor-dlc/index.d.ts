/** Extension point exposed by the Eden text editor. */
export type EditorHighlighterExtensionPoint = "language-highlighters";

/** Extension point for opening and saving non-text document formats. */
export type EditorDocumentHandlerExtensionPoint = "document-handlers";

/** Any extension point described by this package. */
export type EditorExtensionPoint =
  | EditorHighlighterExtensionPoint
  | EditorDocumentHandlerExtensionPoint;

/** Localized language name shown by the editor. */
export type EditorLanguageName = string | Record<string, string>;

/**
 * Metadata stored in a language-highlighters DLC contribution.
 * Paths are relative to the DLC root and extensions omit the leading dot.
 */
export interface EditorHighlighterContributionMetadata {
  entry: string;
  languages: EditorLanguageMetadata[];
}

/** A language advertised by a highlighter DLC. */
export interface EditorLanguageMetadata {
  id: string;
  name: EditorLanguageName;
  extensions: string[];
}

/** Theme-controlled semantic styles understood by the editor. */
export type EditorHighlightStyle =
  | "plain"
  | "comment"
  | "keyword"
  | "operator"
  | "number"
  | "string"
  | "variable"
  | "property"
  | "type"
  | "function"
  | "label"
  | "heading"
  | "link"
  | "meta"
  | "invalid";

/** A half-open, UTF-16 range relative to the supplied line. */
export interface EditorHighlightSpan<TokenKind extends string = string> {
  from: number;
  to: number;
  kind: TokenKind;
}

/** Context passed to a line highlighter. Line numbers are one-based. */
export interface EditorHighlightContext {
  path: string;
  languageId: string;
  lineNumber: number;
}

/** A synchronous, line-local highlighter supplied by a DLC module. */
export interface EditorLineHighlighter<TokenKind extends string = string> {
  tokenStyles: Readonly<Record<TokenKind, EditorHighlightStyle>>;
  highlightLine(
    text: string,
    context: EditorHighlightContext,
  ): readonly EditorHighlightSpan<TokenKind>[];
}

/** Default-export shape of the contribution's ES module. */
export interface EditorHighlighterModule {
  highlighters: Readonly<Record<string, EditorLineHighlighter>>;
}

/**
 * Metadata stored in a document-handlers DLC contribution.
 * Paths are relative to the DLC root and extensions omit the leading dot.
 */
export interface EditorDocumentHandlerContributionMetadata {
  entry: string;
  handlers: EditorDocumentHandlerMetadata[];
}

/** A document format advertised by a document-handler DLC. */
export interface EditorDocumentHandlerMetadata {
  id: string;
  extensions: string[];
}

/** Context passed to a document handler. */
export interface EditorDocumentHandlerContext {
  path: string;
  handlerId: string;
}

/** Opens and saves one text document backed by an arbitrary byte format. */
export interface EditorDocumentHandler {
  open(
    source: Uint8Array,
    context: EditorDocumentHandlerContext,
  ): string | Promise<string>;
  save(
    content: string,
    source: Uint8Array,
    context: EditorDocumentHandlerContext,
  ): Uint8Array | Promise<Uint8Array>;
}

/** Default-export shape of a document-handlers contribution's ES module. */
export interface EditorDocumentHandlerModule {
  handlers: Readonly<Record<string, EditorDocumentHandler>>;
}

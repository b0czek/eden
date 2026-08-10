import { describe, expect, it } from "vitest";
import highlighterModule, { highlightHttpLine } from "./index.mjs";
import manifest from "./manifest.json";

describe("built-in HTTP request highlighter DLC", () => {
  it("exports the language advertised by its DLC manifest", () => {
    const languageIds = manifest.contributions.flatMap((contribution) =>
      contribution.metadata.languages.map((language) => language.id),
    );

    expect(Object.keys(highlighterModule.highlighters)).toEqual(languageIds);
  });

  it("highlights request lines and headers", () => {
    expect(
      highlightHttpLine("POST https://api.example.test/items HTTP/1.1"),
    ).toEqual([
      { from: 0, to: 4, kind: "method" },
      { from: 5, to: 35, kind: "url" },
      { from: 36, to: 44, kind: "protocol" },
    ]);
    expect(highlightHttpLine("Content-Type: application/json")).toEqual([
      { from: 0, to: 12, kind: "header" },
      { from: 12, to: 13, kind: "operator" },
    ]);
  });

  it("highlights variables, separators, comments, and JSON bodies", () => {
    expect(highlightHttpLine("@host = https://example.test")).toEqual([
      { from: 0, to: 5, kind: "variable" },
      { from: 6, to: 7, kind: "operator" },
      { from: 8, to: 28, kind: "url" },
    ]);
    expect(highlightHttpLine("### Create an item")).toEqual([
      { from: 0, to: 18, kind: "separator" },
    ]);
    expect(highlightHttpLine("  # setup request")).toEqual([
      { from: 2, to: 17, kind: "comment" },
    ]);
    expect(highlightHttpLine('{"enabled": true, "count": 2}')).toEqual([
      { from: 0, to: 1, kind: "operator" },
      { from: 1, to: 10, kind: "string" },
      { from: 10, to: 11, kind: "operator" },
      { from: 12, to: 16, kind: "keyword" },
      { from: 16, to: 17, kind: "operator" },
      { from: 18, to: 25, kind: "string" },
      { from: 25, to: 26, kind: "operator" },
      { from: 27, to: 28, kind: "number" },
      { from: 28, to: 29, kind: "operator" },
    ]);
  });
});

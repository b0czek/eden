import { scoreName } from "./search";

function rank(names: string[], query: string) {
  return names
    .map((name) => ({ name, score: scoreName(name, query) }))
    .filter((entry) => entry.score !== undefined)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((entry) => entry.name);
}

it("matches names without regard to case", () => {
  expect(scoreName("Report.PDF", "report.pdf")).toBe(
    scoreName("report.pdf", "REPORT.pdf"),
  );
  expect(scoreName("Documents", "doc")).toBeDefined();
});

it("ranks exact, stem, prefix, word, substring, then fuzzy matches", () => {
  expect(
    rank(
      [
        "bar-chart.txt",
        "annual-report.txt",
        "report.txt",
        "reportage",
        "misreported",
        "rpt",
        "report",
      ],
      "report",
    ),
  ).toEqual([
    "report",
    "report.txt",
    "reportage",
    "annual-report.txt",
    "misreported",
  ]);
  expect(rank(["Notes.md", "Desktop", "NewTestSuite"], "nts")).toEqual([
    "NewTestSuite",
    "Notes.md",
  ]);
});

it("rejects names that lack the query characters in order", () => {
  expect(scoreName("notes.md", "stn")).toBeUndefined();
  expect(scoreName("a", "ab")).toBeUndefined();
});

it("accepts abbreviations but rejects scattered characters", () => {
  for (const [name, query] of [
    ["Omnibox.tsx", "omnbx"],
    ["Downloads", "dwnld"],
    ["report.txt", "rprt"],
  ]) {
    expect(scoreName(name, query)).toBeDefined();
  }
  expect(scoreName("chrome-sandbox", "omnbx")).toBeUndefined();
  expect(
    scoreName("oitFinalSimpleBlend.fragment-Bmp4RaKx.js", "omnbx"),
  ).toBeUndefined();
});

it("treats glob syntax in the query as plain characters", () => {
  expect(scoreName("draft [v2] (final).txt", "[v2] (final)")).toBeDefined();
  expect(scoreName("draft v2 final.txt", "[v2]")).toBeUndefined();
  expect(scoreName("anything", "*")).toBeUndefined();
});

it("finds a tight match after an earlier occurrence of its first character", () => {
  expect(scoreName("o-legacy-build-omnibox.tsx", "omnbx")).toBeDefined();
});

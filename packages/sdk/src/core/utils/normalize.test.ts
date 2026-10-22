import { normalizeAppIds } from "./normalize";

describe("normalizeAppIds", () => {
  it("returns an empty set for undefined or empty input", () => {
    expect(normalizeAppIds()).toEqual(new Set());
    expect(normalizeAppIds([])).toEqual(new Set());
  });

  it("trims whitespace, removes empty entries, and ensures uniqueness", () => {
    const result = normalizeAppIds([
      " app.one ",
      "",
      "app.two",
      "app.one",
      "   ",
    ]);
    const values = Array.from(result).sort();
    expect(values).toEqual(["app.one", "app.two"]);
  });
});

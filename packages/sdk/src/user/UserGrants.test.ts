import {
  defaultGrantsForRole,
  matchesGrants,
  normalizeGrants,
} from "./UserGrants";

describe("UserGrants", () => {
  it("returns wildcard grants by default for all roles", () => {
    expect(defaultGrantsForRole("vendor")).toEqual(["*"]);
    expect(defaultGrantsForRole("standard")).toEqual(["*"]);
  });

  it("normalizes grants for standard users", () => {
    expect(
      normalizeGrants("standard", [" fs/read ", "", "fs/read", "fs/* "]),
    ).toEqual(["fs/read", "fs/*"]);

    expect(normalizeGrants("standard", ["*", "fs/read"])).toEqual(["*"]);
  });

  it("normalizes grants for vendors to wildcard", () => {
    expect(normalizeGrants("vendor", ["fs/read"])).toEqual(["*"]);
  });

  it("matches exact and globbed grants", () => {
    expect(matchesGrants(["fs/read"], "fs/read")).toBe(true);
    expect(matchesGrants(["*"], "anything/here")).toBe(true);
    expect(matchesGrants(["fs/*"], "fs/read")).toBe(true);
    expect(matchesGrants(["fs/*"], "net/read")).toBe(false);
  });
});

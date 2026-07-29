import "reflect-metadata";

import type { RuntimeAppManifest } from "@edenapp/types";
import { AppRegistry } from "./AppRegistry";

const manifest = (id: string): RuntimeAppManifest =>
  ({
    id,
    name: id,
    version: "1.0.0",
    isPrebuilt: false,
    isDevelopment: false,
    isCore: false,
    isRestricted: false,
    resolvedGrants: [],
  }) as RuntimeAppManifest;

describe("AppRegistry", () => {
  it("registers, replaces, lists, and unregisters manifests", () => {
    const registry = new AppRegistry();
    const first = manifest("app.one");
    const replacement = { ...first, version: "2.0.0" };

    registry.register(first);
    expect(registry.has(first.id)).toBe(true);
    expect(registry.get(first.id)).toBe(first);
    expect(registry.list()).toEqual([first]);

    registry.register(replacement);
    expect(registry.get(first.id)).toBe(replacement);
    expect(registry.list()).toEqual([replacement]);

    expect(registry.unregister(first.id)).toBe(true);
    expect(registry.has(first.id)).toBe(false);
    expect(registry.list()).toEqual([]);
  });
});

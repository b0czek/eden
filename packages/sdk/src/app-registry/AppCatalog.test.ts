import "reflect-metadata";

import type { RuntimeAppManifest } from "@edenapp/types";
import { AppCatalog } from "./AppCatalog";
import { AppRegistry } from "./AppRegistry";

const manifest = (
  id: string,
  options: Partial<RuntimeAppManifest> = {},
): RuntimeAppManifest =>
  ({
    id,
    name: id,
    version: "1.0.0",
    frontend: { entry: "dist/index.html" },
    isPrebuilt: false,
    isCore: false,
    isRestricted: false,
    resolvedGrants: [],
    ...options,
  }) as RuntimeAppManifest;

describe("AppCatalog", () => {
  it("centralizes visibility and user-access filtering", () => {
    const registry = new AppRegistry();
    registry.register(manifest("app.visible"));
    registry.register(manifest("app.restricted"));
    registry.register(manifest("app.hidden", { hidden: true }));
    registry.register(manifest("app.overlay", { overlay: true }));

    const catalog = new AppCatalog(
      registry,
      {
        canLaunchApp: (appId: string) => appId !== "app.restricted",
      } as never,
      "/installed",
      "/dist",
    );

    expect(catalog.get("app.visible")?.id).toBe("app.visible");
    expect(catalog.has("app.hidden")).toBe(true);
    expect(catalog.all()).toHaveLength(4);
    expect(catalog.prebuilt()).toEqual([]);
    expect(catalog.installed()).toHaveLength(4);
    expect(catalog.getPath("app.visible")).toBe("/installed/app.visible");
    expect(catalog.getLaunchable("app.visible")?.id).toBe("app.visible");
    expect(catalog.getLaunchable("app.restricted")).toBeUndefined();
    expect(catalog.list().map((app) => app.id)).toEqual(["app.visible"]);
    expect(catalog.list({ showHidden: true }).map((app) => app.id)).toEqual([
      "app.visible",
      "app.hidden",
      "app.overlay",
    ]);
    expect(
      catalog
        .list({ showHidden: true, showRestricted: true })
        .map((app) => app.id),
    ).toEqual(["app.visible", "app.restricted", "app.hidden", "app.overlay"]);
  });
});

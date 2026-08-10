import "reflect-metadata";

import type { RuntimeAppManifest, RuntimeDlcManifest } from "@edenapp/types";
import { PackageRegistry } from "./PackageRegistry";

const app: RuntimeAppManifest = {
  kind: "app",
  id: "app.example",
  name: "App",
  version: "1.0.0",
  isPrebuilt: false,
  isDevelopment: false,
  isCore: false,
  isRestricted: false,
  resolvedGrants: [],
};

const dlc: RuntimeDlcManifest = {
  kind: "dlc",
  id: "dlc.example",
  name: "DLC",
  version: "1.0.0",
  hostAppId: app.id,
  contributions: [],
  isPrebuilt: false,
};

describe("PackageRegistry", () => {
  it("registers and narrows both package kinds", () => {
    const registry = new PackageRegistry();
    registry.register(app);
    registry.register(dlc);

    expect(registry.getApp(app.id)).toEqual(app);
    expect(registry.getDlc(dlc.id)).toEqual(dlc);
    expect(registry.all()).toEqual([app, dlc]);
  });

  it("returns copies and unregisters by package ID", () => {
    const registry = new PackageRegistry();
    registry.register(app, { sourcePath: "/source/app.example" });
    const returned = registry.getApp(app.id);
    if (!returned) throw new Error("Expected registered app");
    returned.name = "Changed";

    expect(registry.getApp(app.id)?.name).toBe("App");
    expect(registry.getSourcePath(app.id)).toBe("/source/app.example");
    expect(registry.unregister(app.id)).toBe(true);
    expect(registry.get(app.id)).toBeUndefined();
    expect(registry.getSourcePath(app.id)).toBeUndefined();
  });
});

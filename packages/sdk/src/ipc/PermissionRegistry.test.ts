import "reflect-metadata";

import { PermissionRegistry, getAllEventPermissions, getEventPermission, registerEventPermission } from "./PermissionRegistry";

import type { ResolvedGrant } from "@edenapp/types";

describe("PermissionRegistry", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("registers base permissions and evaluates matches", () => {
    const registry = new PermissionRegistry();

    registry.registerApp("app.one", ["fs/read", "fs/*"], []);

    expect(registry.hasApp("app.one")).toBe(true);
    expect(registry.hasPermission("app.one", "fs/read")).toBe(true);
    expect(registry.hasPermission("app.one", "fs/write")).toBe(true);
    expect(registry.hasPermission("app.one", "net/read")).toBe(false);
  });

  it("returns required grant keys when permission is not base", () => {
    const registry = new PermissionRegistry();

    const grants: ResolvedGrant[] = [
      {
        scope: "preset",
        id: "appearance/manage",
        preset: "appearance/manage",
        label: "Appearance",
        permissions: ["appearance/manage"],
      },
      {
        scope: "app",
        id: "special",
        label: "Special",
        permissions: ["net/*"],
      },
      {
        scope: "app",
        id: "empty",
        label: "Empty",
        permissions: [],
      },
    ];

    registry.registerApp("app.two", ["fs/read"], grants);

    expect(registry.getRequiredGrantKeys("app.two", "fs/read")).toEqual([]);
    expect(registry.getRequiredGrantKeys("app.two", "appearance/manage")).toEqual([
      "preset/appearance/manage",
    ]);
    expect(registry.getRequiredGrantKeys("app.two", "net/write")).toEqual([
      "app/app.two/special",
    ]);
  });

  it("unregisters apps when no permissions or grants are provided", () => {
    const registry = new PermissionRegistry();

    registry.registerApp("app.three", [], []);
    expect(registry.hasApp("app.three")).toBe(false);

    registry.registerApp("app.three", ["fs/read"], []);
    expect(registry.hasApp("app.three")).toBe(true);

    registry.registerApp("app.three", [], []);
    expect(registry.hasApp("app.three")).toBe(false);
  });
});

describe("Event Permission Registry", () => {
  it("tracks required permissions for events", () => {
    registerEventPermission("app/ready", "app/observe");

    expect(getEventPermission("app/ready")).toBe("app/observe");

    const permissions = getAllEventPermissions();
    expect(permissions.get("app/ready")).toBe("app/observe");
  });
});

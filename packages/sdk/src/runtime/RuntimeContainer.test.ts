import "reflect-metadata";

import type { RuntimeAppManifest } from "@edenapp/types";
import { container } from "tsyringe";
import { PermissionRegistry } from "../ipc/PermissionRegistry";
import { PackageRegistry } from "../package-manager/PackageRegistry";
import { SessionContext } from "../session/SessionContext";

const manifest = (id: string): RuntimeAppManifest =>
  ({
    kind: "app",
    id,
    name: id,
    version: "1.0.0",
    isPrebuilt: false,
    isDevelopment: false,
    isCore: false,
    isRestricted: false,
    resolvedGrants: [],
  }) as RuntimeAppManifest;

describe("runtime child containers", () => {
  it("isolate mutable registries and session state", async () => {
    const first = container.createChildContainer();
    const second = container.createChildContainer();

    const firstApps = first.resolve(PackageRegistry);
    const secondApps = second.resolve(PackageRegistry);
    const firstPermissions = first.resolve(PermissionRegistry);
    const secondPermissions = second.resolve(PermissionRegistry);
    const firstSession = first.resolve(SessionContext);
    const secondSession = second.resolve(SessionContext);

    firstApps.register(manifest("app.first"));
    firstPermissions.registerApp("app.first", ["fs/read"]);
    firstPermissions.registerEventPermission("app/changed", "app/read");
    firstSession.setCurrentUser({
      username: "first",
      name: "First",
      role: "standard",
      grants: [],
      createdAt: 1,
      updatedAt: 1,
    });

    expect(secondApps.get("app.first")).toBeUndefined();
    expect(secondPermissions.hasApp("app.first")).toBe(false);
    expect(secondPermissions.getEventPermission("app/changed")).toBeUndefined();
    expect(secondSession.getCurrentUser()).toBeNull();
    expect(firstApps).not.toBe(secondApps);
    expect(firstPermissions).not.toBe(secondPermissions);
    expect(firstSession).not.toBe(secondSession);

    await first.dispose();
    await second.dispose();
  });
});

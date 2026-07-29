import "reflect-metadata";

import type { EdenConfig, UserProfile } from "@edenapp/types";
import { SessionContext } from "./SessionContext";

const createUser = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  username: "operator",
  name: "Operator",
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("SessionContext", () => {
  it("denies authorization without an active user", () => {
    const context = new SessionContext({} as EdenConfig);

    expect(context.hasGrant("preset/files/read")).toBe(false);
    expect(context.canLaunchApp("app.one")).toBe(false);
    expect(context.canAccessSetting("com.eden", "appearance.theme")).toBe(
      false,
    );
  });

  it("applies grants, core apps, and restricted apps", () => {
    const context = new SessionContext({
      coreApps: ["app.core"],
      restrictedApps: ["app.restricted"],
    } as EdenConfig);
    context.setCurrentUser(
      createUser({
        grants: ["apps/launch/app.allowed", "settings/com.eden/*"],
      }),
    );

    expect(context.canLaunchApp("app.core")).toBe(true);
    expect(context.canLaunchApp("app.allowed")).toBe(true);
    expect(context.canLaunchApp("app.restricted")).toBe(false);
    expect(context.canLaunchApp("app.other")).toBe(false);
    expect(context.canAccessSetting("com.eden", "appearance.theme")).toBe(true);
  });

  it("gives vendor sessions unrestricted authorization", () => {
    const context = new SessionContext({
      restrictedApps: ["app.restricted"],
    } as EdenConfig);
    context.setCurrentUser(createUser({ role: "vendor" }));

    expect(context.hasGrant("anything")).toBe(true);
    expect(context.canLaunchApp("app.restricted")).toBe(true);
    expect(context.canAccessSetting("any", "setting")).toBe(true);
  });
});

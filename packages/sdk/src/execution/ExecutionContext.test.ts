import "reflect-metadata";

import type { EdenConfig, UserProfile } from "@edenapp/types";
import { ExecutionContext } from "./ExecutionContext";

const createUser = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  username: "operator",
  name: "Operator",
  role: "standard",
  grants: [],
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe("ExecutionContext authorization", () => {
  it("denies authorization without a user principal", () => {
    const context = new ExecutionContext({} as EdenConfig);

    expect(context.hasGrant("preset/files/read")).toBe(false);
    expect(context.canLaunchApp("app.one")).toBe(false);
  });

  it("applies grants and app launch policy to the effective principal", () => {
    const context = new ExecutionContext({
      coreApps: ["app.core"],
      restrictedApps: ["app.restricted"],
    } as EdenConfig);
    const profile = createUser({
      grants: ["apps/launch/app.allowed", "settings/com.eden/*"],
    });

    context.run({ principal: { kind: "user", profile } }, () => {
      expect(context.canLaunchApp("app.core")).toBe(true);
      expect(context.canLaunchApp("app.allowed")).toBe(true);
      expect(context.canLaunchApp("app.restricted")).toBe(false);
      expect(context.canLaunchApp("app.other")).toBe(false);
      expect(context.hasGrant("settings/com.eden/appearance.theme")).toBe(true);
    });
  });

  it("gives vendor principals unrestricted authorization", () => {
    const context = new ExecutionContext({
      restrictedApps: ["app.restricted"],
    } as EdenConfig);
    const profile = createUser({ role: "vendor" });

    context.run({ principal: { kind: "user", profile } }, () => {
      expect(context.hasGrant("anything")).toBe(true);
      expect(context.canLaunchApp("app.restricted")).toBe(true);
    });
  });
});

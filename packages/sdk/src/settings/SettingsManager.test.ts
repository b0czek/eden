import "reflect-metadata";

import type { RuntimeAppManifest } from "@edenapp/types";
import { SettingsManager } from "./SettingsManager";

const ownerManifest = {
  id: "app.owner",
  settings: [
    {
      id: "behavior",
      name: "Behavior",
      settings: [
        {
          key: "shared",
          label: "Shared",
          type: "toggle",
          defaultValue: "false",
          sharedWith: ["app.reader"],
        },
        {
          key: "private",
          label: "Private",
          type: "toggle",
        },
      ],
    },
  ],
} as RuntimeAppManifest;

const createManager = () => {
  const manager = Object.create(SettingsManager.prototype) as SettingsManager;
  Object.assign(manager, {
    appCatalog: {
      get: (appId: string) =>
        appId === ownerManifest.id ? ownerManifest : undefined,
    },
    executionContext: {
      hasGrant: () => true,
    },
    keyv: {
      get: jest.fn().mockResolvedValue(undefined),
    },
  });
  return manager;
};

describe("SettingsManager shared reads", () => {
  it("allows owners and declared readers only", () => {
    const manager = createManager();

    expect(manager.canRead("app.owner", "private", "app.owner")).toBe(true);
    expect(manager.canRead("app.owner", "shared", "app.reader")).toBe(true);
    expect(manager.canRead("app.owner", "private", "app.reader")).toBe(false);
    expect(manager.canRead("app.owner", "shared", "app.other")).toBe(false);
  });

  it("rejects missing and unauthorized cross-app settings", () => {
    const manager = createManager();

    expect(() =>
      manager.assertReadableBy("app.owner", "private", "app.reader"),
    ).toThrow("not allowed");
    expect(() =>
      manager.assertReadableBy("app.owner", "missing", "app.reader"),
    ).toThrow("does not exist");
  });

  it("returns an app setting default when no value is stored", async () => {
    const manager = createManager();

    await expect(manager.get("app.owner", "shared")).resolves.toBe("false");
  });
});

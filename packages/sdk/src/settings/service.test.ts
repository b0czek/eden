import type { SettingsCategory } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEffectRuntime } from "../effects/runtime";
import { createSettings } from "./service";

const ownerSettings: SettingsCategory[] = [
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
      { key: "private", label: "Private", type: "toggle" },
    ],
  },
];

async function acquireSettings(
  runtime: ReturnType<typeof createEffectRuntime>,
  grants = true,
) {
  const values = new Map<string, string>();
  return runtime.acquire(
    createSettings({
      storage: {
        open: Effect.succeed({
          read: (key) => Effect.sync(() => values.get(key)),
          write: (key, value) =>
            Effect.sync(() => {
              values.set(key, value);
            }),
          remove: (key) =>
            Effect.sync(() => {
              values.delete(key);
            }),
          keys: () => Effect.sync(() => [...values.keys()]),
        }),
      },
      catalog: {
        getAppSettings: (appId) =>
          appId === "app.owner" ? ownerSettings : undefined,
      },
      authorization: { hasGrant: () => grants },
    }),
  );
}

describe("settings shared reads", () => {
  const runtime = createEffectRuntime();
  afterAll(() => runtime.dispose());

  it("allows owners and declared readers only", async () => {
    const settings = await acquireSettings(runtime);
    expect(settings.canRead("app.owner", "private", "app.owner")).toBe(true);
    expect(settings.canRead("app.owner", "shared", "app.reader")).toBe(true);
    expect(settings.canRead("app.owner", "private", "app.reader")).toBe(false);
    expect(settings.canRead("app.owner", "shared", "app.other")).toBe(false);
  });

  it("rejects missing and unauthorized cross-app settings and enforces reader grants", async () => {
    const settings = await acquireSettings(runtime);
    expect(() =>
      settings.assertReadableBy("app.owner", "private", "app.reader"),
    ).toThrow("not allowed");
    expect(() =>
      settings.assertReadableBy("app.owner", "missing", "app.reader"),
    ).toThrow("does not exist");
    const restricted = await acquireSettings(runtime, false);
    expect(() =>
      restricted.assertReadableBy("app.owner", "shared", "app.reader"),
    ).toThrow("User does not have grant");
  });

  it("returns a declared default when no app value is stored", async () => {
    const settings = await acquireSettings(runtime);
    await expect(
      runtime.run(settings.get("app.owner", "shared")),
    ).resolves.toBe("false");
  });
});

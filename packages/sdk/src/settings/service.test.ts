import type { SettingsCategory } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createEffectRuntime } from "../../tests/support/effect-runtime";
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
  grants: boolean | ((grant: string) => boolean) = true,
  values = new Map<string, unknown>(),
) {
  return runtime.acquire(
    createSettings({
      storage: {
        open: Effect.succeed({
          read: (key) => Effect.sync(() => values.get(key)),
          readMany: (keys) =>
            Effect.sync(() => keys.map((key) => values.get(key))),
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
      authorization: {
        hasGrant: typeof grants === "function" ? grants : () => grants,
      },
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

  it("filters bulk app values by namespace and grants while normalizing legacy values", async () => {
    const settings = await acquireSettings(
      runtime,
      (grant) => grant === "settings/app.owner/shared",
      new Map<string, unknown>([
        ["app.owner:private", "secret"],
        ["app.other:shared", "foreign"],
        ["app.owner:shared", false],
      ]),
    );
    await expect(runtime.run(settings.getAll("app.owner"))).resolves.toEqual({
      shared: "false",
    });
    await expect(
      runtime.run(settings.getAll("app.owner", true)),
    ).resolves.toEqual({ private: "secret", shared: "false" });
  });

  it("combines bulk system values with schema defaults and excludes undeclared keys", async () => {
    const settings = await acquireSettings(
      runtime,
      (grant) =>
        grant === "settings/com.eden/general.locale" ||
        grant === "settings/com.eden/general.interfaceScale",
      new Map([
        ["com.eden:general.locale", "pl"],
        ["com.eden:undeclared", "ignored"],
      ]),
    );
    await expect(runtime.run(settings.getAll("com.eden"))).resolves.toEqual({
      "general.locale": "pl",
      "general.interfaceScale": "1.0",
    });
  });
});

import type { SettingsCategory } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createTestExecutionContext } from "../../../tests/support/callers";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import { log } from "../../platform/logging/logger";
import { ExecutionContext } from "../execution/context";
import { SettingAccessError } from "./errors";
import { SettingsCatalog, SettingsStorage } from "./ports";
import { Settings, SettingsLive } from "./service";

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
    buildService(Settings, SettingsLive).pipe(
      Effect.provideServiceEffect(
        SettingsStorage,
        Effect.succeed({
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
      ),
      Effect.provideService(SettingsCatalog, {
        getAppSettings: (appId) =>
          appId === "app.owner" ? ownerSettings : undefined,
      }),
      Effect.provideServiceEffect(
        ExecutionContext,
        createTestExecutionContext(
          typeof grants === "function" ? grants : () => grants,
        ),
      ),
    ),
  );
}

describe("settings shared reads", () => {
  const runtime = createEffectRuntime();
  afterAll(() => runtime.dispose());

  it("allows owners and declared readers only", async () => {
    const settings = await acquireSettings(runtime);
    expect(
      settings.readAccessError("app.owner", "private", "app.owner"),
    ).toBeUndefined();
    expect(
      settings.readAccessError("app.owner", "shared", "app.reader"),
    ).toBeUndefined();
    expect(
      settings.readAccessError("app.owner", "private", "app.reader"),
    ).toMatchObject({ reason: "reader" });
    expect(
      settings.readAccessError("app.owner", "shared", "app.other"),
    ).toMatchObject({ reason: "reader" });
  });

  it("rejects missing and unauthorized cross-app settings and enforces reader grants", async () => {
    const settings = await acquireSettings(runtime);
    for (const [key, reason] of [
      ["private", "reader"],
      ["missing", "missing"],
    ] as const) {
      expect(settings.readAccessError("app.owner", key, "app.reader")).toEqual(
        new SettingAccessError({
          appId: "app.owner",
          key,
          readerAppId: "app.reader",
          reason,
        }),
      );
    }
    const restricted = await acquireSettings(runtime, false);
    expect(
      restricted.readAccessError("app.owner", "shared", "app.reader"),
    ).toMatchObject({
      _tag: "SettingAccessError",
      reason: "grant",
    });
    expect(
      restricted.readAccessError("app.owner", "private", "app.owner"),
    ).toBeUndefined();
    expect(
      settings.readAccessError("app.owner", "shared", "app.reader"),
    ).toBeUndefined();
  });

  it("evaluates grants when the access Effect executes", async () => {
    let permitted = false;
    const settings = await acquireSettings(runtime, () => permitted);
    const check = settings.assertAccess("app.owner", "private");
    permitted = true;
    await expect(runtime.run(check)).resolves.toBeUndefined();
    permitted = false;
    await expect(runtime.run(Effect.result(check))).resolves.toMatchObject({
      _tag: "Failure",
      failure: { _tag: "SettingAccessError", reason: "grant" },
    });
  });

  it("rejects reset without a default without changing the stored value", async () => {
    const settings = await acquireSettings(
      runtime,
      true,
      new Map([["app.owner:private", "preserved"]]),
    );
    const changes: string[] = [];
    settings.changed.on(({ value }) => {
      changes.push(value);
    });
    const result = await runtime.run(
      Effect.result(settings.reset("app.owner", "private", ownerSettings)),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "SettingDefaultMissingError",
        appId: "app.owner",
        key: "private",
      },
    });
    await expect(
      runtime.run(settings.get("app.owner", "private")),
    ).resolves.toBe("preserved");
    expect(changes).toEqual([]);
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
    const warning = jest.spyOn(log, "warn").mockImplementation(() => {});
    try {
      await expect(runtime.run(settings.getAll("app.owner"))).resolves.toEqual({
        shared: "false",
      });
      await expect(
        runtime.run(settings.getAll("app.owner", true)),
      ).resolves.toEqual({ private: "secret", shared: "false" });
      expect(warning.mock.calls).toEqual([
        ["Non-string value found for key shared, converting to string"],
        ["Non-string value found for key shared, converting to string"],
      ]);
    } finally {
      warning.mockRestore();
    }
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

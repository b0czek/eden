import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { SettingAccessError } from "../../../src/core/settings/errors";
import { createTestCaller } from "../../support/callers";
import { createTestEden } from "../../support/create-test-eden";

it("keeps denied cross-namespace reads and superuser setting mutations in the expected failure channel", async () => {
  const eden = await createTestEden();
  try {
    const { caller } = await createTestCaller(
      eden,
      "restricted.app",
      ["settings/rw", "settings/superuser"],
      { grants: [] },
    );
    const commands = [
      "settings/get",
      "settings/get/su",
      "settings/set/su",
      "settings/reset/su",
    ];
    for (const command of commands) {
      const exit = await eden.runtime.effects.run(
        Effect.exit(
          eden.runtime.services.commands.execute(
            command,
            { appId: "other.app", key: "private", value: "changed" },
            caller,
          ),
        ),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(false);
        const errors = exit.cause.reasons
          .filter(Cause.isFailReason)
          .map((reason) => reason.error);
        expect(errors).toEqual([expect.any(SettingAccessError)]);
      }
    }
    expect(
      await eden.runtime.effects.run(
        eden.runtime.services.settings.get("other.app", "private"),
      ),
    ).toBeUndefined();
  } finally {
    await eden.dispose();
  }
});

it("routes settings commands by trusted caller and gates cross-namespace access", async () => {
  const eden = await createTestEden();
  try {
    const { caller } = await createTestCaller(eden, "app.first", [
      "settings/rw",
    ]);
    const permissions = eden.runtime.services.permissions;
    permissions.registerApp("app.second", ["settings/rw"]);
    permissions.registerApp("app.admin", ["settings/superuser"]);
    const second = { ...caller, appId: "app.second" };
    const admin = { ...caller, appId: "app.admin" };
    await eden.execute(
      "settings/set",
      { key: "theme", value: "light" },
      second,
    );
    await eden.execute(
      "settings/set",
      { key: "theme", value: "dark", _callerAppId: "app.second" },
      caller,
    );
    expect(
      await eden.execute("settings/get", { key: "theme" }, caller),
    ).toEqual({ value: "dark" });
    expect(
      await eden.execute("settings/get", { key: "theme" }, second),
    ).toEqual({ value: "light" });
    await expect(
      eden.execute(
        "settings/get/su",
        { appId: "app.second", key: "theme" },
        caller,
      ),
    ).rejects.toThrow("Permission denied");
    expect(
      await eden.execute(
        "settings/get/su",
        { appId: "app.second", key: "theme" },
        admin,
      ),
    ).toEqual({ value: "light" });
    await expect(
      eden.execute("settings/get", {
        key: "theme",
        _callerAppId: "app.second",
      }),
    ).rejects.toThrow("caller app identity");
  } finally {
    await eden.dispose();
  }
});

it("returns prototype-named setting keys in get-all responses", async () => {
  const eden = await createTestEden();
  try {
    const { caller } = await createTestCaller(eden, "app.keys", [
      "settings/rw",
    ]);
    const values = Object.fromEntries([
      ["__proto__", "prototype value"],
      ["constructor", "constructor value"],
      ["toString", "string value"],
    ]);
    for (const [key, value] of Object.entries(values))
      await eden.execute("settings/set", { key, value }, caller);
    const result = await eden.execute<{ settings: Record<string, string> }>(
      "settings/get-all",
      {},
      caller,
    );
    expect(result.settings).toEqual(values);
    expect(Object.hasOwn(result.settings, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.settings)).toBe(Object.prototype);
  } finally {
    await eden.dispose();
  }
});

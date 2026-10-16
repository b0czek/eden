import { PermissionRegistry } from "../../../src/ipc/PermissionRegistry";
import { createTestCaller } from "../../support/callers";
import { createTestEden } from "../../support/createTestEden";

it("routes settings commands by trusted caller and gates cross-namespace access", async () => {
  const eden = await createTestEden();
  try {
    const { caller } = await createTestCaller(eden, "app.first", [
      "settings/rw",
    ]);
    const permissions = eden.runtime.resolve(PermissionRegistry);
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

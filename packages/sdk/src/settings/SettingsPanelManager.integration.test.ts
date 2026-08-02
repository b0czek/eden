import "reflect-metadata";
import { createTestEden, type TestEden } from "../testing/createTestEden";
import { SettingsManager } from "./SettingsManager";
import { SettingsPanelManager } from "./SettingsPanelManager";

describe("SettingsPanelManager integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("runs built-in actions through real domain managers and persistence", async () => {
    eden = await createTestEden();
    const user = await eden.runtime.users.create({
      username: "settings-user",
      name: "Settings User",
      password: "password",
      grants: ["preset/appearance/manage", "preset/package/manage"],
    });
    await eden.runtime.sessions.login(user.username, "password");

    const panels = eden.runtime.resolve(SettingsPanelManager);
    await panels.invokeAction("eden.appearance", "set-wallpaper", {
      wallpaper: { type: "preset", id: "midnight" },
    });
    await panels.invokeAction("eden.apps", "set-autostart", {
      appId: "com.example.autostart",
      enabled: true,
    });

    expect(await eden.runtime.appearance.getWallpaper()).toMatchObject({
      id: "midnight",
      value: "#1a1b26",
    });
    const settings = eden.runtime.resolve(SettingsManager);
    expect(await settings.get("com.eden", "appearance.wallpaper")).toBe(
      JSON.stringify({ type: "preset", id: "midnight" }),
    );
    expect(
      await settings.get("com.eden", "autostart.com.example.autostart"),
    ).toBe("true");
  });
});

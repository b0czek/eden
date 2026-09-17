import "reflect-metadata";
import type { SettingsPanelResponse } from "@edenapp/types";
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
      value: { wallpaper: { type: "preset", id: "midnight" } },
    });
    await panels.invokeAction("eden.apps", "set-autostart", {
      params: { appId: "com.example.autostart" },
      value: true,
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

  it("exposes a dynamic host collection through the real settings boundary", async () => {
    eden = await createTestEden();
    const user = await eden.runtime.users.create({
      username: "panel-user",
      name: "Panel User",
      password: "password",
      grants: ["panels/devices"],
    });
    await eden.runtime.sessions.login(user.username, "password");
    const manager = eden.runtime.resolve(SettingsPanelManager);
    let items = ["one", "two"];
    const registration = manager.registerPanel(
      {
        id: "vendor.devices",
        title: "Devices",
        grant: "panels/devices",
        actions: [
          {
            id: "remove",
            params: {
              type: "object",
              required: true,
              properties: { deviceId: { type: "string", required: true } },
              additionalProperties: false,
            },
          },
        ],
      },
      {
        load: async () => ({
          sections: [
            {
              id: "devices",
              nodes: [
                {
                  kind: "collection",
                  id: "devices",
                  label: "Devices",
                  items: items.map((id) => ({
                    id,
                    title: id,
                    nodes: [
                      {
                        kind: "button",
                        id: "remove",
                        label: "Remove",
                        action: {
                          actionId: "remove",
                          params: { deviceId: id },
                        },
                      },
                    ],
                  })),
                },
              ],
            },
          ],
        }),
        actions: {
          remove: async ({ params }) => {
            items = items.filter((id) => id !== params?.deviceId);
          },
        },
      },
    );

    await expect(
      eden.execute<{ panels: { id: string }[] }>("settings/panels"),
    ).resolves.toMatchObject({
      panels: expect.arrayContaining([
        expect.objectContaining({ id: registration.panelId }),
      ]),
    });
    const before = await eden.execute<SettingsPanelResponse>("settings/panel", {
      panelId: registration.panelId,
    });
    expect(before.panel).toMatchObject({
      renderer: "generic",
      view: {
        sections: [{ nodes: [{ items: [{ id: "one" }, { id: "two" }] }] }],
      },
    });
    await expect(
      eden.execute("settings/action", {
        panelId: registration.panelId,
        actionId: "remove",
        invocation: { params: { deviceId: "one" } },
      }),
    ).resolves.toEqual({ success: true });
    registration.invalidate();
    const after = await eden.execute<SettingsPanelResponse>("settings/panel", {
      panelId: registration.panelId,
    });
    expect(after.panel).toMatchObject({
      view: { sections: [{ nodes: [{ items: [{ id: "two" }] }] }] },
    });
  });
});

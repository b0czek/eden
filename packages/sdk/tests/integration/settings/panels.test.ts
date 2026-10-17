import type { SettingsPanelResponse } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { createTestEden, type TestEden } from "../../support/createTestEden";

describe("SettingsPanels integration", () => {
  let eden: TestEden;

  afterEach(async () => {
    await eden?.dispose();
  });

  it("runs built-in actions through real domain managers and persistence", async () => {
    eden = await createTestEden();
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "settings-user",
        name: "Settings User",
        password: "password",
        grants: ["preset/appearance/manage", "preset/package/manage"],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );

    const panels = eden.runtime.services.settingsPanels;
    await eden.runtime.effects.run(
      panels.invokeAction("eden.appearance", "set-wallpaper", {
        value: { wallpaper: { type: "preset", id: "midnight" } },
      }),
    );
    await eden.runtime.effects.run(
      panels.invokeAction("eden.apps", "set-autostart", {
        params: { appId: "com.example.autostart" },
        value: true,
      }),
    );

    expect(
      await eden.runtime.effects.run(eden.runtime.appearance.getWallpaper()),
    ).toMatchObject({
      id: "midnight",
      value: "#1a1b26",
    });
    const settings = eden.runtime.services.settings;
    expect(
      await eden.runtime.effects.run(
        settings.get("com.eden", "appearance.wallpaper"),
      ),
    ).toBe(JSON.stringify({ type: "preset", id: "midnight" }));
    expect(
      await eden.runtime.effects.run(
        settings.get("com.eden", "autostart.com.example.autostart"),
      ),
    ).toBe("true");
  });

  it("exposes a dynamic host collection through the real settings boundary", async () => {
    eden = await createTestEden();
    const user = await eden.runtime.effects.run(
      eden.runtime.users.create({
        username: "panel-user",
        name: "Panel User",
        password: "password",
        grants: ["panels/devices"],
      }),
    );
    await eden.runtime.effects.run(
      eden.runtime.sessions.login(user.username, "password"),
    );
    const panels = eden.runtime.services.settingsPanels;
    let items = ["one", "two"];
    const registration = eden.runtime.settings.registerPanel(
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
        load: () =>
          Effect.try({
            try: () => ({
              sections: [
                {
                  id: "devices",
                  nodes: [
                    {
                      kind: "collection" as const,
                      id: "devices",
                      label: "Devices",
                      items: items.map((id) => ({
                        id,
                        title: id,
                        nodes: [
                          {
                            kind: "button" as const,
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
            catch: (error) =>
              error instanceof Error ? error : new Error(String(error)),
          }),
        actions: {
          remove: ({ params }) => {
            return Effect.try({
              try: () => {
                items = items.filter((id) => id !== params?.deviceId);
              },
              catch: (error) =>
                error instanceof Error ? error : new Error(String(error)),
            });
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

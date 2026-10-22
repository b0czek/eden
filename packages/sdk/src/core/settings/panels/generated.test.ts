import type { RuntimeAppManifest } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { testApp } from "../../../../tests/support/apps";
import { createSettingsPanelHarness as harness } from "../../../../tests/support/settings/panel-harness";
import { panelUser as user } from "../../../../tests/support/settings/panels";

describe("SettingsPanels manifest panels", () => {
  it("normalizes one app panel and reads only setting-granted keys", async () => {
    const { panels, settings, catalog } = harness(
      user(["settings/com.example.app/visible"]),
    );
    const manifest: RuntimeAppManifest = testApp("com.example.app", {
      name: "Example",
      settings: [
        {
          id: "general",
          name: "General",
          settings: [
            { key: "visible", label: "Visible", type: "text" },
            { key: "hidden", label: "Hidden", type: "text" },
          ],
        },
      ],
    });
    catalog.allApps.mockReturnValue([manifest]);
    settings.get.mockImplementation((_appId: string, key: string) =>
      Effect.succeed(`${key}-value`),
    );

    panels.synchronizeManifestPanels();
    expect(panels.listGrantOptions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          grant: "settings/com.example.app/visible",
          kind: "setting",
        }),
        expect.objectContaining({
          grant: "settings/com.example.app/hidden",
          kind: "setting",
        }),
      ]),
    );
    expect(await Effect.runPromise(panels.listPanels())).toEqual([
      expect.objectContaining({
        id: "app.com.example.app",
        source: "application",
      }),
    ]);

    const response = await Effect.runPromise(
      panels.loadPanel("app.com.example.app"),
    );
    expect(response.panel?.renderer).toBe("generic");
    if (response.panel?.renderer !== "generic")
      throw new Error("Expected generic panel");
    expect(response.panel.view.sections[0]?.nodes).toHaveLength(1);
    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(settings.get).toHaveBeenCalledWith("com.example.app", "visible");
  });

  it("loads an ungranted field and its value for vendor users", async () => {
    const { panels, settings, catalog } = harness(user([], { role: "vendor" }));
    settings.get.mockReturnValue(Effect.succeed("private-value"));
    catalog.allApps.mockReturnValue([
      {
        kind: "app",
        id: "com.example.app",
        name: "Example",
        version: "1.0.0",
        settings: [
          {
            id: "general",
            name: "General",
            settings: [{ key: "private", label: "Private", type: "text" }],
          },
        ],
        isPrebuilt: false,
        isDevelopment: false,
        isCore: false,
        isRestricted: false,
        resolvedGrants: [],
      } as RuntimeAppManifest,
    ]);

    panels.synchronizeManifestPanels();
    expect(await Effect.runPromise(panels.listPanels())).toHaveLength(1);
    const response = await Effect.runPromise(
      panels.loadPanel("app.com.example.app"),
    );
    expect(response.panel).toMatchObject({
      renderer: "generic",
      view: {
        sections: [
          {
            id: "general",
            nodes: [
              {
                kind: "input",
                input: "text",
                label: "Private",
                value: "private-value",
              },
            ],
          },
        ],
      },
    });
  });

  it("skips invalid app panels without interrupting catalog synchronization", async () => {
    const { panels, catalog } = harness(user([], { role: "vendor" }));
    catalog.allApps.mockReturnValue([
      {
        kind: "app",
        id: "com.example.invalid",
        name: "Invalid",
        version: "1.0.0",
        settings: [
          {
            id: "invalid category",
            name: "Invalid",
            settings: [{ key: "value", label: "Value", type: "text" }],
          },
        ],
        isPrebuilt: false,
        isDevelopment: false,
        isCore: false,
        isRestricted: false,
        resolvedGrants: [],
      } as RuntimeAppManifest,
      {
        kind: "app",
        id: "com.example.valid",
        name: "Valid",
        version: "1.0.0",
        settings: [
          {
            id: "general",
            name: "General",
            settings: [{ key: "value", label: "Value", type: "text" }],
          },
        ],
        isPrebuilt: false,
        isDevelopment: false,
        isCore: false,
        isRestricted: false,
        resolvedGrants: [],
      } as RuntimeAppManifest,
    ]);

    expect(() => panels.synchronizeManifestPanels()).not.toThrow();
    expect(await Effect.runPromise(panels.listPanels())).toEqual([
      expect.objectContaining({ id: "app.com.example.valid" }),
    ]);
  });
});

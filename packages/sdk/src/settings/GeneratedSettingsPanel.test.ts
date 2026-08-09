import type { RuntimeAppManifest } from "@edenapp/types";
import {
  createSettingsPanelHarness as harness,
  panelUser as user,
} from "./SettingsPanelTestHarness";

describe("SettingsPanelManager manifest panels", () => {
  it("normalizes one app panel and reads only setting-granted keys", async () => {
    const { manager, settings, catalog } = harness(
      user(["settings/com.example.app/visible"]),
    );
    const manifest: RuntimeAppManifest = {
      kind: "app",
      id: "com.example.app",
      name: "Example",
      version: "1.0.0",
      frontend: { entry: "index.html" },
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
      isPrebuilt: false,
      isDevelopment: false,
      isCore: false,
      isRestricted: false,
      resolvedGrants: [],
    };
    catalog.allApps.mockReturnValue([manifest]);
    settings.get.mockImplementation(
      async (_appId: string, key: string) => `${key}-value`,
    );

    manager.synchronizeManifestPanels();
    expect(manager.listGrantOptions()).toEqual(
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
    expect(await manager.listPanels()).toEqual([
      expect.objectContaining({
        id: "app.com.example.app",
        source: "application",
      }),
    ]);

    const response = await manager.loadPanel("app.com.example.app");
    expect(response.panel?.sections[0]?.controls).toHaveLength(1);
    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(settings.get).toHaveBeenCalledWith("com.example.app", "visible");
  });

  it("allows vendor users to see every generated field", async () => {
    const { manager, catalog } = harness(user([], { role: "vendor" }));
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

    manager.synchronizeManifestPanels();
    expect(await manager.listPanels()).toHaveLength(1);
  });

  it("skips invalid app panels without interrupting catalog synchronization", async () => {
    const { manager, catalog } = harness(user([], { role: "vendor" }));
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

    expect(() => manager.synchronizeManifestPanels()).not.toThrow();
    expect(await manager.listPanels()).toEqual([
      expect.objectContaining({ id: "app.com.example.valid" }),
    ]);
  });
});

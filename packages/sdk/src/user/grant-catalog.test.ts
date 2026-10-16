import type { RuntimeAppManifest, UserGrantOption } from "@edenapp/types";
import { createGrantCatalog } from "./grant-catalog";

const app = {
  id: "com.example.app",
  name: "Example",
  description: "Example app",
  version: "1.0.0",
  isPrebuilt: false,
  isDevelopment: false,
  isCore: false,
  isRestricted: false,
  resolvedGrants: [
    {
      scope: "preset",
      id: "network/manage",
      preset: "network/manage",
      label: "Network",
      permissions: ["network/manage"],
    },
    {
      scope: "app",
      id: "advanced",
      label: "Advanced",
      permissions: ["app/advanced"],
    },
  ],
} as RuntimeAppManifest;

describe("GrantCatalog", () => {
  it("combines and deduplicates app and panel grants", () => {
    const panelOptions: UserGrantOption[] = [
      {
        grant: "preset/network/manage",
        kind: "panel",
        label: "Duplicate panel grant",
      },
      {
        grant: "panels/runtime",
        kind: "panel",
        label: "Runtime panel",
      },
    ];
    const catalog = createGrantCatalog({
      packageCatalog: { allApps: () => [app] },
      settingsPanels: { listGrantOptions: () => panelOptions },
    });

    expect(catalog.getOptions().options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          grant: "apps/launch/com.example.app",
          kind: "app-launch",
        }),
        expect.objectContaining({
          grant: "preset/network/manage",
          kind: "preset",
          label: "Network",
        }),
        expect.objectContaining({
          grant: "app/com.example.app/advanced",
          kind: "app-feature",
        }),
        expect.objectContaining({ grant: "panels/runtime", kind: "panel" }),
      ]),
    );
    expect(
      catalog
        .getOptions()
        .options.filter((option) => option.grant === "preset/network/manage"),
    ).toHaveLength(1);
  });

  it("coalesces runtime catalog invalidations", async () => {
    const notify = jest.fn();
    const catalog = createGrantCatalog({
      packageCatalog: { allApps: () => [] },
      settingsPanels: { listGrantOptions: () => [] },
    });
    catalog.changed.on(notify);
    catalog.invalidate();
    catalog.invalidate();
    catalog.invalidate();
    await Promise.resolve();

    expect(catalog.getOptions().revision).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      revision: 2,
    });
  });
});

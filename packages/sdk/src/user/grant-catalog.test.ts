import type { RuntimeAppManifest, UserGrantOption } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  buildService,
  createEffectRuntime,
} from "../../tests/support/effect-runtime";
import { PackageCatalog } from "../packages/catalog";
import { SettingsPanels } from "../settings/panels/service";
import { GrantCatalog, GrantCatalogLive } from "./grant-catalog";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

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
    const catalog = serviceEffects.acquireSync(
      buildService(GrantCatalog, GrantCatalogLive).pipe(
        Effect.provide(
          Layer.mock(PackageCatalog, { ...catalogReads, allApps: () => [app] }),
        ),
        Effect.provide(
          Layer.mock(SettingsPanels, {
            ...panelReads,
            listGrantOptions: () => panelOptions,
          }),
        ),
      ),
    );

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
    const catalog = serviceEffects.acquireSync(
      buildService(GrantCatalog, GrantCatalogLive).pipe(
        Effect.provide(
          Layer.mock(PackageCatalog, { ...catalogReads, allApps: () => [] }),
        ),
        Effect.provide(
          Layer.mock(SettingsPanels, {
            ...panelReads,
            listGrantOptions: () => [],
          }),
        ),
      ),
    );
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

function unused(): never {
  throw new Error("Unexpected collaborator operation");
}
const unusedEvent = {
  on: unused,
  emit: unused,
  dispose: unused,
  hasListeners: unused,
};
const catalogReads = {
  dlcDirectory: "/unused",
  get: unused,
  has: unused,
  all: unused,
  getApp: unused,
  hasApp: unused,
  prebuiltApps: unused,
  installedApps: unused,
  developmentApps: unused,
  listApps: unused,
  getLaunchableApp: unused,
  getDlc: unused,
  hasDlc: unused,
  allDlcs: unused,
  dlcsForHost: unused,
  getPath: unused,
};
const panelReads = {
  registerPanel: unused,
  registerBuiltinPanel: unused,
  synchronizeManifestPanels: unused,
  registerGeneratedBuiltinCategory: unused,
  dispose: unused,
  changed: unusedEvent,
  synchronizeManifestPanel: unused,
  removeManifestPanel: unused,
  invalidate: unused,
};

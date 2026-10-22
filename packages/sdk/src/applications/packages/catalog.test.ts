import type { RuntimeAppManifest, RuntimeDlcManifest } from "@edenapp/types";
import * as Effect from "effect/Effect";
import { testApp } from "../../../tests/support/apps";
import {
  buildService,
  createEffectRuntime,
} from "../../../tests/support/effect-runtime";
import {
  ExecutionContext,
  ExecutionContextLive,
} from "../../core/execution/context";
import { AppsDirectory, DistPath, RuntimeConfig } from "../../runtime/inputs";
import { PackageCatalog, PackageCatalogLive } from "./catalog";
import { InstalledPackages, InstalledPackagesLive } from "./installed";

const serviceEffects = createEffectRuntime();
afterAll(() => serviceEffects.dispose());

const manifest = (
  id: string,
  options: Partial<RuntimeAppManifest> = {},
): RuntimeAppManifest =>
  testApp(id, {
    frontend: { entry: "dist/index.html" },
    ...options,
  }) as RuntimeAppManifest;

const createInventory = () => {
  const registry = serviceEffects.acquireSync(
    buildService(InstalledPackages, InstalledPackagesLive),
  );
  const catalog = serviceEffects.acquireSync(
    buildService(PackageCatalog, PackageCatalogLive).pipe(
      Effect.provideService(InstalledPackages, registry),
      Effect.provideService(ExecutionContext, {
        ...serviceEffects.acquireSync(
          buildService(ExecutionContext, ExecutionContextLive).pipe(
            Effect.provideService(RuntimeConfig, {}),
          ),
        ),
        canLaunchApp: (appId: string) => appId !== "app.restricted",
      }),
      Effect.provideService(AppsDirectory, "/installed"),
      Effect.provideService(DistPath, "/dist"),
    ),
  );
  return { catalog, registry };
};

describe("PackageCatalog", () => {
  it("owns a unified app and DLC inventory", () => {
    const { catalog, registry } = createInventory();
    registry.register(manifest("app.visible"));
    const dlc: RuntimeDlcManifest = {
      kind: "dlc",
      id: "dlc.theme",
      name: "Theme",
      version: "1.0.0",
      hostAppId: "app.visible",
      contributions: [],
      isPrebuilt: false,
    };
    registry.register(dlc);
    registry.register({ ...dlc, id: "dlc.builtin", isPrebuilt: true });

    expect(catalog.get("app.visible")?.kind).toBe("app");
    expect(catalog.get("dlc.theme")).toEqual(dlc);
    expect(catalog.all()).toHaveLength(3);
    expect(catalog.getPath("dlc.theme")).toBe("/installed/.dlcs/dlc.theme");
    expect(catalog.getPath("dlc.builtin")).toBe(
      "/dist/apps/prebuilt/dlc.builtin",
    );
    expect(
      catalog.dlcsForHost("app.visible").map((manifest) => manifest.id),
    ).toEqual(["dlc.theme", "dlc.builtin"]);
  });

  it("centralizes app visibility and user-access filtering", () => {
    const { catalog, registry } = createInventory();
    registry.register(manifest("app.visible"));
    registry.register(manifest("app.restricted"));
    registry.register(manifest("app.hidden", { hidden: true }));
    registry.register(manifest("app.overlay", { overlay: true }));

    expect(catalog.getApp("app.visible")?.id).toBe("app.visible");
    expect(catalog.hasApp("app.hidden")).toBe(true);
    expect(catalog.allApps()).toHaveLength(4);
    expect(catalog.prebuiltApps()).toEqual([]);
    expect(catalog.installedApps()).toHaveLength(4);
    expect(catalog.getPath("app.visible")).toBe("/installed/app.visible");
    expect(catalog.getLaunchableApp("app.visible")?.id).toBe("app.visible");
    expect(catalog.getLaunchableApp("app.restricted")).toBeUndefined();
    expect(catalog.listApps().map((app) => app.id)).toEqual(["app.visible"]);
    expect(catalog.listApps({ showHidden: true }).map((app) => app.id)).toEqual(
      ["app.visible", "app.hidden", "app.overlay"],
    );
    expect(
      catalog
        .listApps({ showHidden: true, showRestricted: true })
        .map((app) => app.id),
    ).toEqual(["app.visible", "app.restricted", "app.hidden", "app.overlay"]);
  });

  it("keeps development source paths separate from installed paths", () => {
    const { catalog, registry } = createInventory();
    registry.register(manifest("app.dev", { isDevelopment: true }), {
      sourcePath: "/source/app.dev",
    });

    expect(catalog.getPath("app.dev")).toBe("/source/app.dev");
    expect(catalog.developmentApps()).toHaveLength(1);
    expect(catalog.installedApps()).toHaveLength(0);
  });
});

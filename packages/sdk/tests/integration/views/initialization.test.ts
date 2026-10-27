import assert from "node:assert/strict";
import { testApp } from "../../support/apps";
import { createTestEden, type TestEden } from "../../support/create-test-eden";

it("restores interface scale before creating views and keeps settings updates wired", async () => {
  const first = await createTestEden();
  let restarted: TestEden | undefined;
  try {
    await first.runtime.effects.run(
      first.runtime.services.settings.set(
        "com.eden",
        "general.interfaceScale",
        "1.5",
      ),
    );
    await first.runtime.dispose();
    const eden = await createTestEden({ root: first.paths.root });
    restarted = eden;
    const { views, settings } = eden.runtime.services;
    expect(views.getCurrentScale()).toBe(1.5);

    const bounds = { x: 100, y: 80, width: 450, height: 300 };
    const create = async (scaling: "auto" | "manual") => {
      const manifest = testApp(`com.example.scale-${scaling}`, {
        window: {
          mode: "floating",
          scaling,
          injections: { css: "none", appFrame: "none" },
        },
      });
      const id = await eden.runtime.effects.run(
        views.createView(
          manifest.id,
          manifest,
          eden.paths.appsDirectory,
          bounds,
        ),
      );
      const info = views.getViewInfo(id);
      assert(info, "Created view is missing");
      return info;
    };
    const auto = await create("auto");
    const manual = await create("manual");
    expect(auto.view.webContents.getZoomFactor()).toBe(1.5);
    expect(manual.view.webContents.getZoomFactor()).toBe(1);

    await eden.runtime.effects.run(
      settings.set("com.eden", "general.interfaceScale", "2"),
    );
    expect(views.getCurrentScale()).toBe(2);
    expect(auto.view.webContents.getZoomFactor()).toBe(2);
    expect(auto.bounds).toEqual({ x: 100, y: 80, width: 600, height: 400 });
    expect(auto.view.getBounds()).toEqual(auto.bounds);
    expect(manual.view.webContents.getZoomFactor()).toBe(1);
    expect(manual.bounds).toEqual(bounds);
  } finally {
    await restarted?.dispose();
    await first.dispose();
  }
});

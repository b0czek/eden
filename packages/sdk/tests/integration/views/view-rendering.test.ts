import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as Effect from "effect/Effect";
import { createFloatingWindows } from "../../../src/desktop/views/floating-windows";
import { createViewRendering } from "../../../src/desktop/views/rendering";
import { createTiling } from "../../../src/desktop/views/tiling";
import { testApp } from "../../support/apps";
import { gate } from "../../support/async";
import { createEffectRuntime } from "../../support/effect-runtime";
import { InMemoryPlatform } from "../../support/in-memory-platform";

it.each([false, true])(
  "renders later views while earlier CSS is pending (closed=%s)",
  async (closed) => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "eden-view-rendering-"),
    );
    const effects = createEffectRuntime();
    const inserting = gate();
    const finishCss = gate();
    const rendered = gate<string>();
    try {
      await fs.mkdir(path.join(directory, "edencss"));
      await fs.mkdir(path.join(directory, "app-frame"));
      await fs.writeFile(
        path.join(directory, "edencss/eden.css"),
        "body { color: red; }",
      );
      await fs.writeFile(
        path.join(directory, "app-frame/frame.css"),
        ".frame { display: flex; }",
      );
      await fs.writeFile(
        path.join(directory, "app-frame/frame-injector.js"),
        "window.frameReady = true;",
      );
      const platform = new InMemoryPlatform(directory);
      const tiling = createTiling();
      const floating = createFloatingWindows(
        tiling.getWorkspaceBounds,
        () => [],
      );
      const creator = await effects.acquire(
        createViewRendering(directory, tiling, floating, platform.windows),
      );
      const bounds = { x: 0, y: 0, width: 640, height: 480 };
      const firstApp = testApp("com.example.first-render");
      const first = Effect.runSync(
        creator.createView(firstApp.id, firstApp, directory, bounds, []),
      );
      jest
        .spyOn(first.view.webContents, "insertCSS")
        .mockImplementationOnce(async () => {
          inserting.release();
          await finishCss.promise;
          return "first-css";
        });
      jest.spyOn(first.view, "getBounds").mockImplementation(() => {
        if (first.view.webContents.isDestroyed())
          throw new Error("Object has been destroyed");
        return bounds;
      });
      await inserting.promise;
      if (closed) first.view.webContents.close();
      const secondApp = testApp("com.example.second-render");
      const second = Effect.runSync(
        creator.createView(secondApp.id, secondApp, directory, bounds, []),
      );
      const css: string[] = [];
      jest
        .spyOn(second.view.webContents, "insertCSS")
        .mockImplementation(async (value) => {
          css.push(value);
          return "second-css";
        });
      jest
        .spyOn(second.view.webContents, "executeJavaScript")
        .mockImplementation(async (script) => {
          rendered.release(script);
          return undefined as never;
        });
      expect(await rendered.promise).toContain("window.frameReady = true;");
      expect(css).toEqual(
        expect.arrayContaining([
          "body { color: red; }",
          ".frame { display: flex; }",
        ]),
      );
    } finally {
      finishCss.release();
      jest.restoreAllMocks();
      await effects.dispose();
      await fs.rm(directory, { recursive: true, force: true });
    }
  },
);

it("loads the theme stylesheet after Eden CSS and swaps it on refresh or reload", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "eden-view-theme-"),
  );
  const effects = createEffectRuntime();
  try {
    await fs.mkdir(path.join(directory, "edencss"));
    await fs.writeFile(
      path.join(directory, "edencss/eden.css"),
      ":root { --eden-color-accent-primary: blue; }",
    );
    const platform = new InMemoryPlatform(directory);
    const tiling = createTiling();
    const floating = createFloatingWindows(tiling.getWorkspaceBounds, () => []);
    const creator = await effects.acquire(
      createViewRendering(directory, tiling, floating, platform.windows),
    );
    let theme = ":root { --eden-color-accent-primary: pink; }";
    creator.setThemeSource(() => theme, []);
    const bounds = { x: 0, y: 0, width: 640, height: 480 };
    const themed = testApp("com.example.themed", {
      window: { mode: "floating", injections: { appFrame: false } },
    });
    const unstyled = testApp("com.example.unstyled", {
      window: {
        mode: "floating",
        injections: { appFrame: false, css: "none" },
      },
    });
    const views = [themed, unstyled].map((app) =>
      Effect.runSync(creator.createView(app.id, app, directory, bounds, [])),
    );
    const sheets = (index: number) => [
      ...(
        views[index].view.webContents as unknown as {
          insertedCSS: Map<string, string>;
        }
      ).insertedCSS.values(),
    ];
    await waitFor(() => sheets(0).length === 2);

    expect(sheets(0)).toEqual([
      ":root { --eden-color-accent-primary: blue; }",
      ":root { --eden-color-accent-primary: pink; }",
    ]);
    expect(sheets(1)).toEqual([]);

    theme = "";
    creator.refreshThemeStylesheet(views);
    await waitFor(() => sheets(0).length === 1);
    expect(sheets(0)).toEqual([":root { --eden-color-accent-primary: blue; }"]);
    expect(sheets(1)).toEqual([]);

    // A theme change while the page reloads applies once to the new page.
    theme = ":root { --eden-color-accent-primary: green; }";
    await views[0].view.webContents.loadURL("https://example.test/");
    creator.refreshThemeStylesheet(views);
    await waitFor(() => sheets(0).length === 2);
    creator.refreshThemeStylesheet(views);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sheets(0)).toEqual([
      ":root { --eden-color-accent-primary: blue; }",
      ":root { --eden-color-accent-primary: green; }",
    ]);
  } finally {
    await effects.dispose();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

async function waitFor(condition: () => boolean) {
  for (let attempt = 0; attempt < 100 && !condition(); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

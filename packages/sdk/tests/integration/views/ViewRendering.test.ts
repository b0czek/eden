import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createEffectRuntime } from "../../../src/effects/runtime";
import { createFloatingWindows } from "../../../src/views/floating-windows";
import { createViewRendering } from "../../../src/views/rendering";
import { createTiling } from "../../../src/views/tiling";
import { testApp } from "../../support/apps";
import { gate } from "../../support/async";
import { InMemoryPlatform } from "../../support/InMemoryPlatform";

it("continues rendering later views when an earlier view closes during CSS injection", async () => {
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
    const floating = createFloatingWindows(tiling.getWorkspaceBounds, () => []);
    const creator = await effects.acquire(
      createViewRendering(directory, tiling, floating, platform.windows),
    );
    const bounds = { x: 0, y: 0, width: 640, height: 480 };
    const firstApp = testApp("com.example.first-render");
    const first = creator.createView(
      firstApp.id,
      firstApp,
      directory,
      bounds,
      [],
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
    first.view.webContents.close();
    const secondApp = testApp("com.example.second-render");
    const second = creator.createView(
      secondApp.id,
      secondApp,
      directory,
      bounds,
      [],
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
    finishCss.release();
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
});

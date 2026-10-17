import * as path from "node:path";
import type { EdenConfig } from "@edenapp/types";
import * as Effect from "effect/Effect";
import * as Scope from "effect/Scope";
import type { Autostart } from "../autostart";
import type { Branding } from "../branding";
import type { IpcTransport } from "../ipc/transport";
import type { Keyboard } from "../keyboard";
import type { EdenPlatform, PlatformWindow } from "../platform/ports";
import type { Views } from "../views/service";

/** Each foundation window joins the runtime scope as soon as it is created. */
export const createFoundationWindow = Effect.fn(function* ({
  config,
  paths,
  platform,
  branding,
  views,
  ipc,
  keyboard,
  autostart,
}: {
  config: EdenConfig;
  paths: { distPath: string };
  platform: EdenPlatform;
  branding: Branding;
  views: Views;
  ipc: IpcTransport;
  keyboard: Keyboard;
  autostart: Autostart;
}) {
  const scope = yield* Effect.scope;
  let mainWindow: PlatformWindow | null = null;
  const open = Effect.fn(function* () {
    const windowConfig = config.window || {};
    const title = branding.getWindowTitle(windowConfig.title);
    const window = yield* Scope.provide(
      Effect.acquireRelease(
        Effect.sync(() =>
          platform.windows.createWindow({
            width: windowConfig.width || 1280,
            height: windowConfig.height || 800,
            minWidth: Math.max(windowConfig.minWidth || 800, 800),
            minHeight: Math.max(windowConfig.minHeight || 600, 600),
            title,
            icon: branding.getWindowIconPath(),
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: false,
              preload: path.join(
                paths.distPath,
                "foundation/foundation-preload.js",
              ),
              additionalArguments: [`--window-title=${title}`],
            },
            backgroundColor: windowConfig.backgroundColor || "#1e1e1e",
            autoHideMenuBar: true,
            show: false,
          }),
        ),
        (window) =>
          Effect.sync(() => {
            if (!window.isDestroyed()) window.destroy();
            if (mainWindow === window) mainWindow = null;
          }),
      ),
      scope,
    );
    mainWindow = window;
    platform.windows.attachWebContentsLogger(window.webContents, {
      source: "foundation",
    });
    views.setMainWindow(window);
    ipc.setMainWindow(window);
    yield* keyboard.setMainWindow(window);
    window.loadFile(path.join(paths.distPath, "foundation/foundation.html"));
    window.webContents.once("did-finish-load", () =>
      autostart.onFoundationReady(),
    );
    window.once("ready-to-show", () => window.show());
    window.on("closed", () => {
      if (mainWindow === window) mainWindow = null;
    });
  });
  return { open, isOpen: () => mainWindow !== null };
});

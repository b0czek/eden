import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Eden } from "@edenapp/sdk";
import { expect, test } from "@playwright/test";
import { pauseCommand } from "../../../../../tests/electron/support/commands.js";
import { APP_ID } from "../../../../../tests/electron/support/fixtures.js";
import { useElectronHost } from "../../../../../tests/electron/support/host.js";

test.describe
  .serial("File Picker volume lifecycle", () => {
    const getHost = useElectronHost({
      fixtures: ["integration"],
      apps: ["com.eden.file-picker"],
      launchFixture: true,
    });

    test("restores a restricted picker's listing and watch after its drive reconnects", async () => {
      const host = getHost();

      const running = await host.executeHostCommand<
        { manifest: { id: string } }[]
      >("process/list", {});
      if (!running.some((process) => process.manifest.id === APP_ID))
        await host.executeHostCommand("process/launch", { appId: APP_ID });
      const driveRoot = path.join(host.root, "reconnect-drive");
      await fs.mkdir(driveRoot);
      await fs.writeFile(path.join(driveRoot, "before.txt"), "before");
      const setConnected = async (connected: boolean) => {
        await host.electronApp?.evaluate(
          async (_electron, input) => {
            const integration = globalThis as typeof globalThis & {
              __edenIntegration: {
                eden: Eden;
              };
            };
            if (input.connected) {
              await integration.__edenIntegration.eden.runPromise(
                integration.__edenIntegration.eden.volumes.register({
                  id: "reconnect-usb",
                  label: "Reconnect USB",
                  kind: "removable",
                  rootPath: input.driveRoot,
                }),
              );
            } else {
              integration.__edenIntegration.eden.volumes.unregister(
                "reconnect-usb",
              );
            }
          },
          { connected, driveRoot },
        );
      };

      const listing = () =>
        host.evaluateApp(
          "com.eden.file-picker",
          `document.querySelector('.file-list')?.textContent ?? ''`,
        );
      try {
        await expect
          .poll(() => host.evaluateApp(APP_ID, `typeof window.edenAPI`))
          .toBe("object");
        await setConnected(true);
        await host.evaluateApp(
          APP_ID,
          `window.edenAPI.shellCommand('file-picker/open', {
          mode: 'open', allowedVolumes: ['reconnect-usb'], initialLocation: { volume: 'reconnect-usb', path: '/' }
        })`,
        );
        await expect.poll(listing).toContain("before.txt");
        await setConnected(false);
        await expect.poll(listing).not.toContain("before.txt");
        await fs.writeFile(
          path.join(driveRoot, "reconnected.txt"),
          "reconnected",
        );
        await setConnected(true);
        await expect.poll(listing).toContain("reconnected.txt");
        // A native change after the snapshot proves the new watch is active.
        await fs.writeFile(path.join(driveRoot, "watched.txt"), "watched");
        await expect.poll(listing).toContain("watched.txt");
      } finally {
        await host.executeHostCommand("process/stop", {
          appId: "com.eden.file-picker",
        });
        await setConnected(false);
      }
    });

    test("closes a picker unplugged during its initial scope query and accepts another request", async () => {
      const host = getHost();
      const app = host.electronApp;
      if (!app) throw new Error("Electron app is not running");
      const running = await host.executeHostCommand<
        { manifest: { id: string } }[]
      >("process/list", {});
      if (!running.some((process) => process.manifest.id === APP_ID))
        await host.launchFixture();
      const driveRoot = path.join(host.root, "initializing-drive");
      await fs.mkdir(driveRoot);
      await app.evaluate(async (_electron, rootPath) => {
        const integration = globalThis as typeof globalThis & {
          __edenIntegration: {
            eden: Eden;
          };
        };
        await integration.__edenIntegration.eden.runPromise(
          integration.__edenIntegration.eden.volumes.register({
            id: "initializing-drive",
            label: "Initializing drive",
            kind: "removable",
            rootPath,
          }),
        );
      }, driveRoot);
      const scope = await pauseCommand(host, "fs/access-scope", {
        appId: "com.eden.file-picker",
        args: { volume: "initializing-drive" },
      });
      try {
        await host.evaluateApp(
          APP_ID,
          `(async () => {
          globalThis.__initializingPickerResult = undefined;
          await window.edenAPI.subscribe('file-picker/closed', result => { globalThis.__initializingPickerResult = result; });
          await window.edenAPI.shellCommand('file-picker/open', {
            mode: 'open', allowedVolumes: ['initializing-drive'],
            initialLocation: { volume: 'initializing-drive', path: '/' }
          });
        })()`,
        );
        await scope.waitUntilPending();
        await app.evaluate(() => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              eden: Eden;
            };
          };
          integration.__edenIntegration.eden.volumes.unregister(
            "initializing-drive",
          );
        });
        await scope.dispose();
        await expect
          .poll(() =>
            host.evaluateApp(APP_ID, "globalThis.__initializingPickerResult"),
          )
          .toMatchObject({ reason: "cancel" });
        await host.evaluateApp(
          APP_ID,
          `window.edenAPI.shellCommand('file-picker/open', { mode: 'open' })`,
        );
        await expect
          .poll(() =>
            host.evaluateApp("com.eden.file-picker", "window.innerWidth"),
          )
          .toBeGreaterThan(100);
        await expect
          .poll(() =>
            host.evaluateApp(
              "com.eden.file-picker",
              `document.querySelector('.omnibox-display')?.textContent`,
            ),
          )
          .toBe("/");
        await host.evaluateApp(
          APP_ID,
          `window.edenAPI.shellCommand('file-picker/close', {})`,
        );
      } finally {
        await scope.dispose();
        await host.executeHostCommand("process/stop", {
          appId: "com.eden.file-picker",
        });
      }
    });
  });

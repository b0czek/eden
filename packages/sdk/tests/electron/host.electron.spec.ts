import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { isProcessAlive, useElectronHost } from "./support/host";
import { APP_ID } from "./support/profile";

test.describe
  .serial("host through Electron", () => {
    const getHost = useElectronHost({ launchFixture: false });
    test("reaches ready state and loads the foundation window", async () => {
      const host = getHost();

      await expect(host.foundation).toHaveTitle("Eden Electron Integration");
      await expect(host.foundation.locator("#workspace")).toBeVisible();
      await expect
        .poll(() =>
          host.electronApp?.evaluate(() => {
            const integration = globalThis as typeof globalThis & {
              __edenIntegration?: { eden: { state: string } };
            };
            return integration.__edenIntegration?.eden.state;
          }),
        )
        .toBe("ready");
    });

    test("limits foundation preload IPC to its UI capabilities", async () => {
      const host = getHost();

      const result = await host.foundation.evaluate(async () => {
        const edenWindow = window as typeof window & {
          edenAPI: {
            shellCommand: (command: string, args: unknown) => Promise<unknown>;
          };
        };
        const scale = await edenWindow.edenAPI.shellCommand(
          "view/get-interface-scale",
          {},
        );
        let denied = "";
        try {
          await edenWindow.edenAPI.shellCommand("process/launch", {
            appId: "com.eden.forbidden",
          });
        } catch (error) {
          denied = error instanceof Error ? error.message : String(error);
        }
        return { scale, denied };
      });
      expect(result.scale).toEqual({ scale: 1 });
      expect(result.denied).toContain(
        "Foundation is not allowed to execute process/launch",
      );
    });

    test("launches a bundled app with an associated real view and utility process", async () => {
      const host = getHost();

      const result = await host.executeHostCommand<{
        success: boolean;
        appId: string;
      }>("process/launch", { appId: APP_ID });
      expect(result).toMatchObject({ success: true, appId: APP_ID });

      const processes = await host.executeHostCommand<unknown[]>(
        "process/list",
        {},
      );
      expect(processes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            manifest: expect.objectContaining({ id: APP_ID }),
            viewId: expect.any(Number),
          }),
        ]),
      );

      await expect
        .poll(() =>
          host.electronApp?.evaluate(
            ({ webContents }, appId) =>
              webContents.getAllWebContents().some((contents) => {
                return (
                  contents.getURL().includes(appId) &&
                  contents.getURL().endsWith("/index.html")
                );
              }),
            APP_ID,
          ),
        )
        .toBe(true);

      host.utilityPids =
        (await host.electronApp?.evaluate(({ app }) =>
          app
            .getAppMetrics()
            .filter((metric) => metric.type === "Utility")
            .map((metric) => metric.pid),
        )) ?? [];
      expect(host.utilityPids.length).toBeGreaterThan(0);
      await expect
        .poll(async () => {
          try {
            return JSON.parse(
              await fs.readFile(
                path.join(host.fixtureDirectory, "backend-dlc-result.json"),
                "utf-8",
              ),
            );
          } catch {
            return undefined;
          }
        })
        .toEqual({
          asset: "adjacent asset",
          binary: {
            bytes: [0, 255, 128, 13, 10],
            isUint8Array: true,
          },
          moduleUrl: expect.stringMatching(/^eden-dlc:\/\/resource\//),
          rootUrl: expect.stringMatching(/^eden-dlc:\/\/resource\//),
          value: "loaded-through-eden-dlc",
        });
    });

    test("handles a Hello request in the app backend", async () => {
      const host = getHost();

      const appId = "com.eden.example.hello";
      await host.executeHostCommand("process/launch", { appId });
      try {
        await expect
          .poll(() =>
            host.electronApp?.evaluate(({ webContents }, id) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL().includes(id));
              return contents?.executeJavaScript("document.readyState");
            }, appId),
          )
          .toBe("complete");
        const response = await host.electronApp?.evaluate(
          async ({ webContents }, id) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(id));
            if (!contents) throw new Error("Hello example view not found");
            return contents.executeJavaScript(
              'window.getAppAPI().request("hello", { message: "generated backend" })',
            );
          },
          appId,
        );
        expect(response).toEqual({
          message: "Hello from backend! You said: generated backend",
        });
      } finally {
        await host.executeHostCommand("process/stop", { appId });
      }
    });

    test("shuts down without orphaning Electron or utility processes", async () => {
      const host = getHost();

      const app = host.electronApp;
      expect(app).toBeDefined();
      if (!app) return;

      await app.close();
      host.electronApp = undefined;

      expect(isProcessAlive(host.mainPid)).toBe(false);
      for (const pid of host.utilityPids)
        expect(isProcessAlive(pid)).toBe(false);
    });
  });

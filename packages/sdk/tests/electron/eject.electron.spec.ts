import * as fs from "node:fs/promises";
import * as path from "node:path";
import { expect, test } from "@playwright/test";
import { APP_ID } from "./support/fixtures";
import { useElectronHost } from "./support/host";

test.describe
  .serial("eject through Electron", () => {
    const getHost = useElectronHost({
      fixtures: ["integration"],
      launchFixture: true,
    });

    test("shares pending safe eject completion across renderer and backend IPC", async () => {
      const host = getHost();

      await expect
        .poll(async () => {
          try {
            return await fs.readFile(
              path.join(host.fixtureDirectory, "backend-eject-ready"),
              "utf8",
            );
          } catch {
            return undefined;
          }
        })
        .toBe("ready");
      const driveRoot = path.join(host.root, "slow-eject");
      await fs.mkdir(driveRoot);
      await host.electronApp?.evaluate(async (_electron, rootPath) => {
        const integration = globalThis as typeof globalThis & {
          __edenIntegration: {
            eden: {
              volumes: {
                register(
                  input: unknown,
                  options: { eject: () => Promise<void> },
                ): Promise<unknown>;
              };
            };
          };
        };
        await integration.__edenIntegration.eden.volumes.register(
          { id: "slow-eject", label: "Slow USB", kind: "removable", rootPath },
          {
            eject: () =>
              new Promise<void>((resolve) => {
                (
                  globalThis as typeof globalThis & {
                    __finishIntegrationEject?: () => void;
                  }
                ).__finishIntegrationEject = resolve;
              }),
          },
        );
      }, driveRoot);
      await expect
        .poll(() =>
          host.executeHostCommand<{ id: string; state: string }[]>(
            "volume/list",
            {},
          ),
        )
        .toContainEqual(
          expect.objectContaining({ id: "slow-eject", state: "ejecting" }),
        );
      const rendererHandle = await host.electronApp?.evaluate(
        async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
          const operation = await window.edenAPI.shellCommand("volume/eject", { volume: "slow-eject" });
          return operation.handle;
        })()`);
        },
        APP_ID,
      );
      expect(rendererHandle).toMatchObject({
        command: "volume/eject",
        id: expect.any(String),
      });
      await expect
        .poll(async () => {
          try {
            return JSON.parse(
              await fs.readFile(
                path.join(host.fixtureDirectory, "backend-eject-accepted.json"),
                "utf8",
              ),
            );
          } catch {
            return undefined;
          }
        })
        .toMatchObject({ command: "volume/eject", id: expect.any(String) });
      await host.electronApp?.evaluate(() => {
        const state = globalThis as typeof globalThis & {
          __finishIntegrationEject?: () => void;
        };
        if (!state.__finishIntegrationEject)
          throw new Error("Host eject has not started");
        state.__finishIntegrationEject();
        delete state.__finishIntegrationEject;
      });
      await host.electronApp?.evaluate(
        async ({ webContents }, payload) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(payload.appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(
            `window.edenAPI.operations.from(${JSON.stringify(payload.handle)}).result()`,
          );
        },
        { appId: APP_ID, handle: rendererHandle },
      );
      await expect
        .poll(async () => {
          try {
            return JSON.parse(
              await fs.readFile(
                path.join(host.fixtureDirectory, "backend-eject-result.json"),
                "utf8",
              ),
            );
          } catch {
            return undefined;
          }
        })
        .toEqual({ success: true });
      expect(
        await host.executeHostCommand<{ id: string }[]>("volume/list", {}),
      ).not.toContainEqual(expect.objectContaining({ id: "slow-eject" }));
    });
  });

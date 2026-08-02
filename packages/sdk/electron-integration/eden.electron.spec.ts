import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const APP_ID = "com.eden.integration.fixture";
type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;
type ElectronPage = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;

test.describe
  .serial("built Eden Electron host", () => {
    let electronApp: ElectronApplication | undefined;
    let foundation: ElectronPage;
    let root: string;
    let mainPid: number;
    let utilityPids: number[] = [];
    const logs: string[] = [];

    test.beforeAll(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-electron-"));
      const appsDirectory = path.join(root, "apps");
      const userDirectory = path.join(root, "users");
      const fixtureDirectory = path.join(root, "dist/apps/prebuilt", APP_ID);
      const seedPath = path.join(root, "eden-seed.json");
      await Promise.all([
        fs.mkdir(appsDirectory, { recursive: true }),
        fs.mkdir(userDirectory, { recursive: true }),
        fs.mkdir(path.dirname(fixtureDirectory), { recursive: true }),
      ]);
      await Promise.all([
        fs.cp(
          path.join(__dirname, "../dist/foundation"),
          path.join(root, "dist/foundation"),
          { recursive: true },
        ),
        fs.cp(
          path.join(__dirname, "../dist/app-runtime"),
          path.join(root, "dist/app-runtime"),
          { recursive: true },
        ),
        fs.cp(
          path.join(__dirname, "../edencss"),
          path.join(root, "dist/edencss"),
          { recursive: true },
        ),
      ]);
      await fs.cp(path.join(__dirname, "fixtures/app"), fixtureDirectory, {
        recursive: true,
      });
      await fs.writeFile(
        seedPath,
        JSON.stringify({
          users: [
            {
              username: "integration-vendor",
              name: "Integration Vendor",
              role: "vendor",
              passwordHash: "not-used",
              passwordSalt: "not-used",
            },
          ],
          defaultUsername: "integration-vendor",
        }),
      );

      const executablePath = require("electron") as string;
      electronApp = await electron.launch({
        executablePath,
        args: [path.join(__dirname, "host.cjs")],
        cwd: root,
        env: {
          ...process.env,
          EDEN_LOG_CALLSITE: "false",
          EDEN_TEST_APPS_DIRECTORY: appsDirectory,
          EDEN_TEST_USER_DIRECTORY: userDirectory,
          EDEN_TEST_SEED_PATH: seedPath,
        },
      });
      mainPid = electronApp.process().pid ?? -1;
      electronApp.on("console", async (message) => {
        const values = await Promise.all(
          message.args().map((argument) => argument.jsonValue()),
        );
        logs.push(values.map(String).join(" "));
      });
      await expect
        .poll(async () => {
          const titles = await Promise.all(
            electronApp?.windows().map((page) => page.title()) ?? [],
          );
          return titles.includes("Eden Electron Integration");
        })
        .toBe(true);
      const windows = electronApp.windows();
      const titles = await Promise.all(windows.map((page) => page.title()));
      foundation = windows[titles.indexOf("Eden Electron Integration")];
    });

    // biome-ignore lint/correctness/noEmptyPattern: Playwright requires fixture destructuring.
    test.afterAll(async ({}, testInfo) => {
      if (electronApp) await electronApp.close().catch(() => undefined);
      await testInfo.attach("eden.log", {
        body: logs.join("\n"),
        contentType: "text/plain",
      });
      await testInfo.attach("process-diagnostics.json", {
        body: JSON.stringify({ mainPid, utilityPids }, null, 2),
        contentType: "application/json",
      });
      await fs.rm(root, { recursive: true, force: true });
    });

    test("reaches ready state and loads the foundation window", async () => {
      await expect(foundation).toHaveTitle("Eden Electron Integration");
      await expect(foundation.locator("#workspace")).toBeVisible();
      await expect
        .poll(() =>
          electronApp?.evaluate(() => {
            const integration = globalThis as typeof globalThis & {
              __edenIntegration?: { eden: { state: string } };
            };
            return integration.__edenIntegration?.eden.state;
          }),
        )
        .toBe("ready");
    });

    test("routes foundation preload IPC to a registered Eden command", async () => {
      const capabilities = await foundation.evaluate(() => {
        const edenWindow = window as typeof window & {
          edenAPI: {
            shellCommand: (command: string, args: unknown) => Promise<unknown>;
          };
        };
        return edenWindow.edenAPI.shellCommand("system/power-capabilities", {});
      });
      expect(capabilities).toEqual({ poweroff: false, reboot: false });
    });

    test("launches a bundled app with an associated real view and utility process", async () => {
      const result = await foundation.evaluate((appId) => {
        const edenWindow = window as typeof window & {
          edenAPI: {
            shellCommand: (command: string, args: unknown) => Promise<unknown>;
          };
        };
        return edenWindow.edenAPI.shellCommand("process/launch", { appId });
      }, APP_ID);
      expect(result).toMatchObject({ success: true, appId: APP_ID });

      const processes = await foundation.evaluate(() => {
        const edenWindow = window as typeof window & {
          edenAPI: {
            shellCommand: (command: string, args: unknown) => Promise<unknown>;
          };
        };
        return edenWindow.edenAPI.shellCommand("process/list", {});
      });
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
          electronApp?.evaluate(
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

      utilityPids =
        (await electronApp?.evaluate(({ app }) =>
          app
            .getAppMetrics()
            .filter((metric) => metric.type === "Utility")
            .map((metric) => metric.pid),
        )) ?? [];
      expect(utilityPids.length).toBeGreaterThan(0);
    });

    test("delivers native filesystem changes across preload IPC and stops after unwatch", async () => {
      const watchId = await electronApp?.evaluate(
        async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
            globalThis.__fsChanges = [];
            await window.edenAPI.subscribe("fs/changed", (event) => globalThis.__fsChanges.push(event));
            return (await window.edenAPI.shellCommand("fs/watch", { path: "/" })).watchId;
          })()`);
        },
        APP_ID,
      );
      expect(watchId).toEqual(expect.any(String));

      await fs.writeFile(path.join(root, "users", "external.txt"), "changed");
      await expect
        .poll(() =>
          electronApp?.evaluate(
            async ({ webContents }, { appId, watchId: expectedWatchId }) => {
              const contents = webContents
                .getAllWebContents()
                .find((candidate) => candidate.getURL().includes(appId));
              return contents?.executeJavaScript(
                `globalThis.__fsChanges?.some((event) => event.watchId === ${JSON.stringify(expectedWatchId)} && event.kind === "change")`,
              );
            },
            { appId: APP_ID, watchId },
          ),
        )
        .toBe(true);

      await electronApp?.evaluate(
        async ({ webContents }, { appId, watchId: activeWatchId }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          await contents?.executeJavaScript(
            `window.edenAPI.shellCommand("fs/unwatch", { watchId: ${JSON.stringify(activeWatchId)} })`,
          );
        },
        { appId: APP_ID, watchId },
      );
    });

    test("shuts down without orphaning Electron or utility processes", async () => {
      const app = electronApp;
      expect(app).toBeDefined();
      if (!app) return;

      await app.close();
      electronApp = undefined;

      expect(isProcessAlive(mainPid)).toBe(false);
      for (const pid of utilityPids) expect(isProcessAlive(pid)).toBe(false);
    });
  });

function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

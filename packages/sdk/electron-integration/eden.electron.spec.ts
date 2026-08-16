import * as fs from "node:fs/promises";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";

const APP_ID = "com.eden.integration.fixture";
const PDF_VIEWER_APP_ID = "com.eden.pdf-viewer";
const DLC_ID = "com.eden.integration.fixture.module";
const REMOTE_APP_ID = "com.eden.integration.remote";
const REMOTE_DLC_ID = "com.eden.integration.remote.module";
type ElectronApplication = Awaited<ReturnType<typeof electron.launch>>;
type ElectronPage = Awaited<ReturnType<ElectronApplication["firstWindow"]>>;

test.describe
  .serial("built Eden Electron host", () => {
    let electronApp: ElectronApplication | undefined;
    let foundation: ElectronPage;
    let root: string;
    let mainPid: number;
    let utilityPids: number[] = [];
    let dlcRootUrl: string;
    let remoteServer: http.Server;
    let remoteUrl: string;
    let fixtureDirectory: string;
    let pdfViewerFixtureDirectory: string;
    const logs: string[] = [];

    const executeHostCommand = async <TResult>(
      command: string,
      args: unknown,
    ): Promise<TResult> => {
      if (!electronApp) throw new Error("Electron app is not running");
      return electronApp.evaluate(
        async (_electron, payload) => {
          const integration = globalThis as typeof globalThis & {
            __edenIntegration: {
              execute: (command: string, args: unknown) => Promise<unknown>;
            };
          };
          return integration.__edenIntegration.execute(
            payload.command,
            payload.args,
          );
        },
        { command, args },
      ) as Promise<TResult>;
    };

    test.beforeAll(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), "eden-electron-"));
      const appsDirectory = path.join(root, "apps");
      const userDirectory = path.join(root, "users");
      fixtureDirectory = path.join(root, "dist/apps/prebuilt", APP_ID);
      pdfViewerFixtureDirectory = path.join(
        root,
        "dist/apps/prebuilt",
        PDF_VIEWER_APP_ID,
      );
      const remoteFixtureDirectory = path.join(
        root,
        "dist/apps/prebuilt",
        REMOTE_APP_ID,
      );
      const dlcDirectory = path.join(appsDirectory, ".dlcs", DLC_ID);
      const remoteDlcDirectory = path.join(
        appsDirectory,
        ".dlcs",
        REMOTE_DLC_ID,
      );
      remoteServer = http.createServer((_request, response) => {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy":
            "default-src 'self'; script-src 'self' eden-dlc:; connect-src 'self' eden-dlc:",
        });
        response.end("<!doctype html><title>Remote DLC Fixture</title>");
      });
      await new Promise<void>((resolve) =>
        remoteServer.listen(0, "127.0.0.1", resolve),
      );
      const remoteAddress = remoteServer.address() as AddressInfo;
      remoteUrl = `http://127.0.0.1:${remoteAddress.port}/`;
      const seedPath = path.join(root, "eden-seed.json");
      await Promise.all([
        fs.mkdir(appsDirectory, { recursive: true }),
        fs.mkdir(userDirectory, { recursive: true }),
        fs.mkdir(path.dirname(fixtureDirectory), { recursive: true }),
        fs.mkdir(pdfViewerFixtureDirectory, { recursive: true }),
        fs.mkdir(path.join(dlcDirectory, "dist"), { recursive: true }),
        fs.mkdir(remoteFixtureDirectory, { recursive: true }),
        fs.mkdir(path.join(remoteDlcDirectory, "dist"), { recursive: true }),
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
      await Promise.all([
        fs.cp(
          path.join(__dirname, "../apps/com/eden/pdf-viewer/manifest.json"),
          path.join(pdfViewerFixtureDirectory, "manifest.json"),
        ),
        fs.cp(
          path.join(__dirname, "../apps/com/eden/pdf-viewer/dist"),
          path.join(pdfViewerFixtureDirectory, "dist"),
          { recursive: true },
        ),
      ]);
      await fs.cp(
        path.join(
          __dirname,
          "../apps/com/eden/pdf-viewer/node_modules/@embedpdf/snippet/dist/demo.pdf",
        ),
        path.join(pdfViewerFixtureDirectory, "dist/demo.pdf"),
      );
      await fs.writeFile(
        path.join(userDirectory, "binary-input.bin"),
        new Uint8Array([0, 255, 128, 13, 10]),
      );
      await Promise.all([
        fs.writeFile(
          path.join(dlcDirectory, "manifest.json"),
          JSON.stringify({
            kind: "dlc",
            id: DLC_ID,
            name: "Electron Integration Module",
            version: "1.0.0",
            hostAppId: APP_ID,
            contributions: [
              {
                extensionPoint: "integration-module",
                requires: "^1.0.0",
                metadata: { entry: "dist/entry.mjs" },
              },
            ],
          }),
        ),
        fs.writeFile(
          path.join(dlcDirectory, "dist/dependency.mjs"),
          'export const value = "loaded-through-eden-dlc";',
        ),
        fs.writeFile(
          path.join(dlcDirectory, "dist/entry.mjs"),
          'import { value } from "./dependency.mjs"; export const moduleUrl = import.meta.url; export const asset = await (await fetch(new URL("./asset.txt", import.meta.url))).text(); export default value;',
        ),
        fs.writeFile(
          path.join(dlcDirectory, "dist/asset.txt"),
          "adjacent asset",
        ),
        fs.writeFile(
          path.join(remoteFixtureDirectory, "manifest.json"),
          JSON.stringify({
            id: REMOTE_APP_ID,
            name: "Remote Electron Integration Fixture",
            version: "1.0.0",
            frontend: { entry: remoteUrl },
            dlc: {
              extensionPoints: [{ id: "integration-module", version: "1.0.0" }],
            },
          }),
        ),
        fs.writeFile(
          path.join(remoteDlcDirectory, "manifest.json"),
          JSON.stringify({
            kind: "dlc",
            id: REMOTE_DLC_ID,
            name: "Remote Electron Integration Module",
            version: "1.0.0",
            hostAppId: REMOTE_APP_ID,
            contributions: [
              {
                extensionPoint: "integration-module",
                requires: "^1.0.0",
                metadata: { entry: "dist/entry.mjs" },
              },
            ],
          }),
        ),
        fs.writeFile(
          path.join(remoteDlcDirectory, "dist/entry.mjs"),
          'export default "loaded-from-remote-host";',
        ),
      ]);
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
      await new Promise<void>((resolve) => remoteServer.close(() => resolve()));
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

    test("limits foundation preload IPC to its UI capabilities", async () => {
      const result = await foundation.evaluate(async () => {
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
      const result = await executeHostCommand<{
        success: boolean;
        appId: string;
      }>("process/launch", { appId: APP_ID });
      expect(result).toMatchObject({ success: true, appId: APP_ID });

      const processes = await executeHostCommand<unknown[]>("process/list", {});
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
      await expect
        .poll(async () => {
          try {
            return JSON.parse(
              await fs.readFile(
                path.join(fixtureDirectory, "backend-dlc-result.json"),
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

    test("round-trips binary filesystem data across renderer IPC", async () => {
      const result = await electronApp?.evaluate(
        async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
            const content = new Uint8Array([0, 255, 128, 1, 0]);
            await window.edenAPI.shellCommand("fs/write-binary", {
              path: "/renderer-output.bin",
              content,
            });
            const result = await window.edenAPI.shellCommand("fs/read-binary", {
              path: "/renderer-output.bin",
            });
            return {
              bytes: [...result],
              isUint8Array: result instanceof Uint8Array,
            };
          })()`);
        },
        APP_ID,
      );

      expect(result).toEqual({
        bytes: [0, 255, 128, 1, 0],
        isUint8Array: true,
      });
      await expect(
        fs.readFile(path.join(root, "users", "renderer-output.bin")),
      ).resolves.toEqual(Buffer.from([0, 255, 128, 1, 0]));
    });

    test("supports keyboard focus, policy, and input across nested shadow DOM", async () => {
      const focused = await electronApp?.evaluate(({ webContents }, appId) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) => candidate.getURL().includes(appId));
        if (!contents) throw new Error("Integration app view not found");

        return contents.executeJavaScript(`(() => {
            const input = document
              .getElementById("shadow-input-host")
              .shadowRoot
              .getElementById("inner-shadow-input-host")
              .shadowRoot
              .getElementById("shadow-input");
            input.focus();
            return input === input.getRootNode().activeElement;
          })()`);
      }, APP_ID);
      expect(focused).toBe(true);

      await expect
        .poll(async () => {
          return electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return false;

            return contents.executeJavaScript(`window.edenKeyboard
              .getState()
              .then(({ visible, placementMode, target }) => ({
                visible,
                placementMode,
                targetKind: target?.kind,
              }))`);
          }, APP_ID);
        })
        .toEqual({
          visible: true,
          placementMode: "floating",
          targetKind: "input",
        });

      const actionResult = await electronApp?.evaluate(({ webContents }) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) =>
            candidate.getURL().includes("keyboard-ui/index.html"),
          );
        if (!contents) throw new Error("Keyboard view not found");

        return contents.executeJavaScript(
          'window.edenKeyboard.sendAction({ type: "insertText", text: "Eden" })',
        );
      });
      expect(actionResult).toEqual({ success: true });

      await expect
        .poll(async () => {
          return electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(
              "document.body.dataset.shadowInputValue",
            );
          }, APP_ID);
        })
        .toBe("Eden");
    });

    test("types into the PDF viewer search input with the on-screen keyboard", async () => {
      const hideResult = await electronApp?.evaluate(({ webContents }) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) =>
            candidate.getURL().includes("keyboard-ui/index.html"),
          );
        if (!contents) throw new Error("Keyboard view not found");

        return contents.executeJavaScript("window.edenKeyboard.hide()");
      });
      expect(hideResult).toEqual({ success: true });

      await expect
        .poll(async () => {
          return electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(
              "window.edenKeyboard.getState().then((state) => state.visible)",
            );
          }, APP_ID);
        })
        .toBe(false);

      const launchResult = await executeHostCommand<{
        success: boolean;
        appId: string;
      }>("process/launch", { appId: PDF_VIEWER_APP_ID });
      expect(launchResult).toMatchObject({
        success: true,
        appId: PDF_VIEWER_APP_ID,
      });

      const clickPdfSearchButton = async () => {
        return electronApp?.evaluate(async ({ webContents }, appId) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("PDF viewer app view not found");

          const point = await contents.executeJavaScript(`(() => {
            const button = document
              .querySelector("embedpdf-container")
              .shadowRoot
              .querySelector('button[aria-label="Search"]');
            if (!button) throw new Error("PDF search button not found");
            const rect = button.getBoundingClientRect();
            return {
              x: Math.round(rect.x + rect.width / 2),
              y: Math.round(rect.y + rect.height / 2),
            };
          })()`);
          contents.focus();
          contents.sendInputEvent({
            type: "mouseDown",
            button: "left",
            clickCount: 1,
            ...point,
          });
          contents.sendInputEvent({
            type: "mouseUp",
            button: "left",
            clickCount: 1,
            ...point,
          });
        }, PDF_VIEWER_APP_ID);
      };

      await expect
        .poll(() =>
          electronApp?.evaluate(
            ({ webContents }, appId) =>
              webContents
                .getAllWebContents()
                .some((contents) => contents.getURL().includes(appId)),
            PDF_VIEWER_APP_ID,
          ),
        )
        .toBe(true);

      await electronApp?.evaluate(async ({ webContents }, appId) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) => candidate.getURL().includes(appId));
        if (!contents) throw new Error("PDF viewer app view not found");

        return contents.executeJavaScript(`(async () => {
            const container = document.querySelector("embedpdf-container");
            const registry = await container.registry;
            const documentManager = registry
              .getPlugin("document-manager")
              .provides();
            const response = await fetch(new URL("demo.pdf", location.href));
            const buffer = await response.arrayBuffer();
            await documentManager.openDocumentBuffer({
              buffer,
              name: "demo.pdf",
              documentId: "osk-search-test",
            }).toPromise();
          })()`);
      }, PDF_VIEWER_APP_ID);

      await clickPdfSearchButton();

      await expect
        .poll(() =>
          electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return false;

            return contents.executeJavaScript(`(() => {
              const root = document.querySelector("embedpdf-container").shadowRoot;
              const activeElement = root.activeElement;
              return {
                searchPanel: Boolean(root.querySelector(
                  '[data-sidebar-id="search-panel"]',
                )),
                searchInput: Boolean(root.querySelector(
                  'input[placeholder="Search"]',
                )),
                activeTag: activeElement?.tagName ?? null,
                activeLabel: activeElement?.getAttribute("aria-label") ?? null,
              };
            })()`);
          }, PDF_VIEWER_APP_ID),
        )
        .toEqual({
          searchPanel: true,
          searchInput: true,
          activeTag: "INPUT",
          activeLabel: null,
        });

      await expect
        .poll(async () => {
          return electronApp?.evaluate(async ({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return false;

            return contents.executeJavaScript(`window.edenKeyboard
              .getState()
              .then((state) => ({
                visible: state.visible,
                targetKind: state.target?.kind ?? null,
                documentFocused: document.hasFocus(),
              }))`);
          }, PDF_VIEWER_APP_ID);
        })
        .toEqual({
          visible: true,
          targetKind: "input",
          documentFocused: true,
        });

      const actionResult = await electronApp?.evaluate(({ webContents }) => {
        const contents = webContents
          .getAllWebContents()
          .find((candidate) =>
            candidate.getURL().includes("keyboard-ui/index.html"),
          );
        if (!contents) throw new Error("Keyboard view not found");

        return contents.executeJavaScript(
          'window.edenKeyboard.sendAction({ type: "insertText", text: "invoice" })',
        );
      });
      expect(actionResult).toEqual({ success: true });

      await expect
        .poll(async () => {
          return electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(`document
                .querySelector("embedpdf-container")
                .shadowRoot
                .querySelector('input[placeholder="Search"]')
                .value`);
          }, PDF_VIEWER_APP_ID);
        })
        .toBe("invoice");

      await clickPdfSearchButton();

      await expect
        .poll(async () => {
          return electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(
              "window.edenKeyboard.getState().then((state) => state.visible)",
            );
          }, PDF_VIEWER_APP_ID);
        })
        .toBe(false);

      await clickPdfSearchButton();

      await expect
        .poll(async () => {
          return electronApp?.evaluate(({ webContents }, appId) => {
            const contents = webContents
              .getAllWebContents()
              .find((candidate) => candidate.getURL().includes(appId));
            if (!contents) return undefined;

            return contents.executeJavaScript(`Promise.all([
                window.edenKeyboard.getState(),
                Promise.resolve(document
                  .querySelector("embedpdf-container")
                  .shadowRoot
                  .activeElement
                  ?.matches('input[placeholder="Search"]') ?? false),
              ]).then(([state, focused]) => ({
                visible: state.visible,
                focused,
              }))`);
          }, PDF_VIEWER_APP_ID);
        })
        .toEqual({ visible: true, focused: true });
    });

    test("loads a host-bound DLC module and rejects the same URL from another view", async () => {
      const loaded = await electronApp?.evaluate(
        async ({ webContents }, { appId, dlcId }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Integration app view not found");
          return contents.executeJavaScript(`(async () => {
            const { dlcs: resources } = await window.edenAPI.shellCommand(
              "package/self",
              {},
            );
            const resource = resources.find((candidate) => candidate.manifest.id === ${JSON.stringify(dlcId)});
            const entry = resource.manifest.contributions[0].metadata.entry;
            const module = await import(new URL(entry, resource.rootUrl).href);
            return { asset: module.asset, moduleUrl: module.moduleUrl, value: module.default, rootUrl: resource.rootUrl };
          })()`);
        },
        { appId: APP_ID, dlcId: DLC_ID },
      );
      expect(loaded?.value).toBe("loaded-through-eden-dlc");
      expect(loaded?.asset).toBe("adjacent asset");
      expect(loaded?.moduleUrl).toMatch(/^eden-dlc:\/\/resource\//);
      dlcRootUrl = loaded?.rootUrl;
      expect(dlcRootUrl).toMatch(/^eden-dlc:\/\/resource\//);

      await expect(
        foundation.evaluate(async (rootUrl) => {
          await fetch(new URL("dist/entry.mjs", rootUrl));
        }, dlcRootUrl),
      ).rejects.toThrow();
    });

    test("revokes DLC module URLs when the host stops", async () => {
      await executeHostCommand("process/stop", { appId: APP_ID });
      await executeHostCommand("process/launch", { appId: APP_ID });

      await expect
        .poll(() =>
          electronApp?.evaluate(
            ({ webContents }, appId) =>
              webContents
                .getAllWebContents()
                .some((candidate) => candidate.getURL().includes(appId)),
            APP_ID,
          ),
        )
        .toBe(true);

      const result = await electronApp?.evaluate(
        async ({ webContents }, { appId, oldRootUrl }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL().includes(appId));
          if (!contents) throw new Error("Relaunched app view not found");
          return contents.executeJavaScript(`(async () => {
            let oldUrlRejected = false;
            try { await import(new URL("dist/entry.mjs", ${JSON.stringify(oldRootUrl)}).href); }
            catch { oldUrlRejected = true; }
            const { dlcs: resources } = await window.edenAPI.shellCommand(
              "package/self",
              {},
            );
            return { oldUrlRejected, rootUrl: resources[0].rootUrl };
          })()`);
        },
        { appId: APP_ID, oldRootUrl: dlcRootUrl },
      );
      expect(result?.oldUrlRejected).toBe(true);
      expect(result?.rootUrl).not.toBe(dlcRootUrl);
    });

    test("supports DLC module imports from an HTTP development frontend", async () => {
      await executeHostCommand("process/launch", { appId: REMOTE_APP_ID });
      await expect
        .poll(() =>
          electronApp?.evaluate(
            ({ webContents }, url) =>
              webContents
                .getAllWebContents()
                .some((candidate) => candidate.getURL() === url),
            remoteUrl,
          ),
        )
        .toBe(true);

      const value = await electronApp?.evaluate(
        async ({ webContents }, { url, dlcId }) => {
          const contents = webContents
            .getAllWebContents()
            .find((candidate) => candidate.getURL() === url);
          if (!contents) throw new Error("Remote app view not found");
          return contents.executeJavaScript(`(async () => {
            const { dlcs: resources } = await window.edenAPI.shellCommand(
              "package/self",
              {},
            );
            const resource = resources.find((candidate) => candidate.manifest.id === ${JSON.stringify(dlcId)});
            const module = await import(new URL(resource.manifest.contributions[0].metadata.entry, resource.rootUrl).href);
            return module.default;
          })()`);
        },
        { url: remoteUrl, dlcId: REMOTE_DLC_ID },
      );
      expect(value).toBe("loaded-from-remote-host");
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
